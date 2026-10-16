//! Native screen share: our own source picker plus capture of the chosen
//! screen/window, published straight to LiveKit from Rust.
//!
//! The webview can't do this: `getDisplayMedia` always shows the OS picker and,
//! for system audio, captures everything (including the call itself). Here a
//! window's audio comes only from the app that owns it, like Discord does.

use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use livekit::options::{AudioEncoding, TrackPublishOptions, VideoEncoding};
use livekit::prelude::*;
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::AudioSourceOptions;
use livekit::webrtc::prelude::{
    DegradationPreference, NV12Buffer, RtcAudioSource, RtcVideoSource, VideoFrame, VideoResolution,
    VideoRotation,
};
use livekit::webrtc::video_source::native::NativeVideoSource;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as platform;

#[cfg(target_os = "windows")]
mod win;
#[cfg(target_os = "windows")]
use win as platform;

pub const AUDIO_SAMPLE_RATE: u32 = 48_000;
pub const AUDIO_CHANNELS: u32 = 2;
const SAMPLES_PER_10MS: usize = (AUDIO_SAMPLE_RATE / 100) as usize * AUDIO_CHANNELS as usize;

/// Static screens produce no new frames; resend the last one so viewers who join
/// later (and the encoder after packet loss) still get a picture.
const IDLE_FRAME_REPEAT: Duration = Duration::from_millis(1000);

pub const SHARE_ENDED_EVENT: &str = "native-share-ended";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSourceInfo {
    /// "screen:<id>" or "window:<id>"
    pub id: String,
    pub kind: &'static str,
    pub title: String,
    pub app_name: Option<String>,
    /// JPEG data URL
    pub thumbnail: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartShareArgs {
    pub url: String,
    pub token: String,
    pub source_id: String,
    /// 0 = native size
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
    pub max_bitrate: u64,
    /// "detail" (sharpness) or "motion" (fluidity)
    pub content: String,
    /// Share the audio of the app that owns the window (windows only).
    pub audio: bool,
}

pub struct CaptureOptions {
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
    pub audio: bool,
}

/// Something the platform capture keeps alive; dropping or stopping it ends the capture.
pub trait CaptureHandle: Send {
    fn stop(&mut self);
}

struct LastFrame {
    width: u32,
    height: u32,
    stride_y: u32,
    stride_uv: u32,
    y: Vec<u8>,
    uv: Vec<u8>,
    pushed_at: Instant,
}

/// Where platform capture code delivers frames. Cheap to clone across threads.
#[derive(Clone)]
pub struct FrameSink {
    video: NativeVideoSource,
    audio_tx: Option<mpsc::UnboundedSender<Vec<i16>>>,
    last_frame: Arc<Mutex<Option<LastFrame>>>,
    started: Instant,
    on_ended: Arc<dyn Fn(String) + Send + Sync>,
}

impl FrameSink {
    fn timestamp_us(&self) -> i64 {
        self.started.elapsed().as_micros() as i64
    }

    /// Push an NV12 frame (macOS delivers this format directly).
    pub fn push_nv12(&self, width: u32, height: u32, y: &[u8], stride_y: u32, uv: &[u8], stride_uv: u32) {
        let mut buffer = NV12Buffer::with_strides(width, height, stride_y, stride_uv);
        {
            let (dst_y, dst_uv) = buffer.data_mut();
            let ny = dst_y.len().min(y.len());
            let nuv = dst_uv.len().min(uv.len());
            dst_y[..ny].copy_from_slice(&y[..ny]);
            dst_uv[..nuv].copy_from_slice(&uv[..nuv]);
        }
        self.capture(buffer);

        if let Ok(mut last) = self.last_frame.lock() {
            *last = Some(LastFrame {
                width,
                height,
                stride_y,
                stride_uv,
                y: y.to_vec(),
                uv: uv.to_vec(),
                pushed_at: Instant::now(),
            });
        }
    }

    /// Push a BGRA frame (Windows), scaled down to fit `max` if needed.
    #[allow(dead_code)]
    pub fn push_bgra(&self, data: &[u8], stride: u32, width: u32, height: u32, max: (u32, u32)) {
        use livekit::webrtc::native::yuv_helper;
        use livekit::webrtc::video_frame::native::VideoFrameBufferExt;

        // NV12 needs even dimensions.
        let (w, h) = (width & !1, height & !1);
        if w == 0 || h == 0 {
            return;
        }
        let (tw, th) = fit_within(w, h, max.0, max.1);

        let mut full = NV12Buffer::new(w, h);
        {
            let (stride_y, stride_uv) = full.strides();
            let (dst_y, dst_uv) = full.data_mut();
            yuv_helper::argb_to_nv12(data, stride, dst_y, stride_y, dst_uv, stride_uv, w as i32, h as i32);
        }

        if (tw, th) == (w, h) {
            let (stride_y, stride_uv) = full.strides();
            let (y, uv) = full.data();
            self.push_nv12(w, h, &y.to_vec(), stride_y, &uv.to_vec(), stride_uv);
        } else {
            let mut i420 = full.to_i420();
            let scaled = i420.scale(tw as i32, th as i32);
            let (stride_y, stride_u, stride_v) = scaled.strides();
            let (sy, su, sv) = scaled.data();
            let mut out = NV12Buffer::new(tw, th);
            let (out_stride_y, out_stride_uv) = out.strides();
            {
                let (dst_y, dst_uv) = out.data_mut();
                yuv_helper::i420_to_nv12(
                    sy, stride_y, su, stride_u, sv, stride_v, dst_y, out_stride_y, dst_uv, out_stride_uv,
                    tw as i32, th as i32,
                );
            }
            let (y, uv) = out.data();
            self.push_nv12(tw, th, &y.to_vec(), out_stride_y, &uv.to_vec(), out_stride_uv);
        }
    }

    /// Push interleaved stereo 48kHz i16 samples, any length.
    pub fn push_audio(&self, samples: Vec<i16>) {
        if let Some(tx) = &self.audio_tx {
            let _ = tx.send(samples);
        }
    }

    pub fn has_audio(&self) -> bool {
        self.audio_tx.is_some()
    }

    /// Capture ended on the OS side (window closed, permission revoked…).
    pub fn ended(&self, reason: String) {
        (self.on_ended)(reason);
    }

    fn capture(&self, buffer: NV12Buffer) {
        let frame = VideoFrame {
            rotation: VideoRotation::VideoRotation0,
            timestamp_us: self.timestamp_us(),
            frame_metadata: None,
            buffer,
        };
        self.video.capture_frame(&frame);
    }

    fn repeat_last_frame_if_idle(&self) {
        let Ok(last_guard) = self.last_frame.lock() else { return };
        let Some(last) = last_guard.as_ref() else { return };
        if last.pushed_at.elapsed() < IDLE_FRAME_REPEAT {
            return;
        }
        let mut buffer = NV12Buffer::with_strides(last.width, last.height, last.stride_y, last.stride_uv);
        {
            let (dst_y, dst_uv) = buffer.data_mut();
            let ny = dst_y.len().min(last.y.len());
            let nuv = dst_uv.len().min(last.uv.len());
            dst_y[..ny].copy_from_slice(&last.y[..ny]);
            dst_uv[..nuv].copy_from_slice(&last.uv[..nuv]);
        }
        drop(last_guard);
        self.capture(buffer);
    }
}

/// Largest (even) size with the same aspect ratio that fits in max_w x max_h.
/// 0 means "no limit".
pub fn fit_within(width: u32, height: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    if max_w == 0 || max_h == 0 || (width <= max_w && height <= max_h) {
        return (width & !1, height & !1);
    }
    let scale = f64::min(max_w as f64 / width as f64, max_h as f64 / height as f64);
    let w = ((width as f64 * scale) as u32).max(2) & !1;
    let h = ((height as f64 * scale) as u32).max(2) & !1;
    (w, h)
}

/// Encode a BGRA image as a small JPEG data URL for the picker.
pub fn thumbnail_data_url(bgra: &[u8], stride: usize, width: u32, height: u32) -> Option<String> {
    use base64::Engine;
    use image::{codecs::jpeg::JpegEncoder, imageops, RgbImage};

    let mut rgb = RgbImage::new(width, height);
    for y in 0..height as usize {
        let row = bgra.get(y * stride..y * stride + width as usize * 4)?;
        for x in 0..width as usize {
            let p = &row[x * 4..x * 4 + 4];
            rgb.put_pixel(x as u32, y as u32, image::Rgb([p[2], p[1], p[0]]));
        }
    }
    let (tw, th) = fit_within(width, height, 320, 200);
    let small = imageops::resize(&rgb, tw.max(2), th.max(2), imageops::FilterType::Triangle);

    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 70).encode_image(&small).ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(jpeg)
    ))
}

struct ShareSession {
    room: Arc<Room>,
    capture: Box<dyn CaptureHandle>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

#[derive(Default)]
pub struct ShareState(tokio::sync::Mutex<Option<ShareSession>>);

#[tauri::command]
pub async fn list_capture_sources() -> Result<Vec<CaptureSourceInfo>, String> {
    tauri::async_runtime::spawn_blocking(platform::list_sources)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn start_native_share(
    app: AppHandle,
    state: State<'_, ShareState>,
    args: StartShareArgs,
) -> Result<(), String> {
    let mut session = state.0.lock().await;
    if let Some(old) = session.take() {
        stop_session(old).await;
    }

    // Publish-only connection: never download anything from the room.
    let mut room_options = RoomOptions::default();
    room_options.auto_subscribe = false;
    let (room, mut events) = Room::connect(&args.url, &args.token, room_options)
    .await
    .map_err(|e| format!("Falha ao conectar ao servidor de voz: {e}"))?;
    let room = Arc::new(room);

    let fps = args.fps.clamp(1, 60);
    let video = NativeVideoSource::new(
        VideoResolution {
            width: if args.max_width == 0 { 1920 } else { args.max_width },
            height: if args.max_height == 0 { 1080 } else { args.max_height },
        },
        true,
    );
    let video_track = LocalVideoTrack::create_video_track("screen", RtcVideoSource::Native(video.clone()));
    room.local_participant()
        .publish_track(
            LocalTrack::Video(video_track),
            TrackPublishOptions {
                source: TrackSource::Screenshare,
                video_encoding: Some(VideoEncoding {
                    max_bitrate: args.max_bitrate,
                    max_framerate: fps as f64,
                }),
                simulcast: false,
                degradation_preference: Some(if args.content == "motion" {
                    DegradationPreference::MaintainFramerate
                } else {
                    DegradationPreference::MaintainResolution
                }),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("Falha ao publicar o vídeo: {e}"))?;

    let mut tasks = Vec::new();
    let is_window = args.source_id.starts_with("window:");

    let audio_tx = if args.audio && is_window {
        // No echo cancellation/noise suppression: this is app audio (music,
        // games), not a voice, and processing would mangle it.
        let audio = NativeAudioSource::new(AudioSourceOptions::default(), AUDIO_SAMPLE_RATE, AUDIO_CHANNELS, 100);
        let audio_track = LocalAudioTrack::create_audio_track("screen-audio", RtcAudioSource::Native(audio.clone()));
        room.local_participant()
            .publish_track(
                LocalTrack::Audio(audio_track),
                TrackPublishOptions {
                    source: TrackSource::ScreenshareAudio,
                    audio_encoding: Some(AudioEncoding { max_bitrate: 128_000 }),
                    dtx: false,
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| format!("Falha ao publicar o áudio: {e}"))?;

        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<i16>>();
        tasks.push(tokio::spawn(async move {
            let mut pending: Vec<i16> = Vec::with_capacity(SAMPLES_PER_10MS * 4);
            loop {
                // Capture APIs deliver nothing while the app is silent. Feed silence
                // so the track keeps flowing (listeners' "hearing" check relies on it).
                match tokio::time::timeout(Duration::from_millis(50), rx.recv()).await {
                    Ok(Some(samples)) => pending.extend_from_slice(&samples),
                    Ok(None) => break,
                    Err(_) => pending.resize(pending.len() + SAMPLES_PER_10MS * 5, 0),
                }
                while pending.len() >= SAMPLES_PER_10MS {
                    let chunk: Vec<i16> = pending.drain(..SAMPLES_PER_10MS).collect();
                    let frame = AudioFrame {
                        data: Cow::Owned(chunk),
                        sample_rate: AUDIO_SAMPLE_RATE,
                        num_channels: AUDIO_CHANNELS,
                        samples_per_channel: (SAMPLES_PER_10MS / AUDIO_CHANNELS as usize) as u32,
                    };
                    if let Err(e) = audio.capture_frame(&frame).await {
                        log::warn!("screen audio frame dropped: {e:?}");
                    }
                }
            }
        }));
        Some(tx)
    } else {
        None
    };

    let ended_app = app.clone();
    let sink = FrameSink {
        video,
        audio_tx,
        last_frame: Arc::new(Mutex::new(None)),
        started: Instant::now(),
        on_ended: Arc::new(move |reason: String| {
            let _ = ended_app.emit(SHARE_ENDED_EVENT, reason);
        }),
    };

    let capture = match platform::start_capture(
        &args.source_id,
        CaptureOptions { max_width: args.max_width, max_height: args.max_height, fps, audio: args.audio && is_window },
        sink.clone(),
    ) {
        Ok(capture) => capture,
        Err(e) => {
            let _ = room.close().await;
            tasks.iter().for_each(|t| t.abort());
            return Err(e);
        }
    };

    let idle_sink = sink.clone();
    tasks.push(tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_millis(250));
        loop {
            tick.tick().await;
            idle_sink.repeat_last_frame_if_idle();
        }
    }));

    let events_app = app.clone();
    tasks.push(tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            if let RoomEvent::Disconnected { reason } = event {
                let _ = events_app.emit(SHARE_ENDED_EVENT, format!("Desconectado do servidor de voz ({reason:?})"));
                break;
            }
        }
    }));

    *session = Some(ShareSession { room, capture, tasks });
    Ok(())
}

#[tauri::command]
pub async fn stop_native_share(state: State<'_, ShareState>) -> Result<(), String> {
    if let Some(session) = state.0.lock().await.take() {
        stop_session(session).await;
    }
    Ok(())
}

async fn stop_session(mut session: ShareSession) {
    session.capture.stop();
    session.tasks.iter().for_each(|t| t.abort());
    let _ = session.room.close().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Manual smoke test (needs Screen Recording permission):
    /// cargo test --lib share::tests::capture_smoke -- --ignored --nocapture
    #[test]
    #[ignore]
    fn capture_smoke() {
        let sources = platform::list_sources().expect("list sources");
        for s in &sources {
            println!(
                "{:>7} {:<24} {:<40} thumb={}",
                s.kind,
                s.id,
                format!("{} — {}", s.app_name.clone().unwrap_or_default(), s.title),
                s.thumbnail.as_ref().map(|t| t.len()).unwrap_or(0)
            );
        }
        let window = sources.iter().find(|s| s.kind == "window").expect("a window");

        let rt = tokio::runtime::Runtime::new().unwrap();
        let _guard = rt.enter();
        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<i16>>();
        let frames = Arc::new(AtomicUsize::new(0));
        let sink = FrameSink {
            video: NativeVideoSource::new(VideoResolution { width: 1920, height: 1080 }, true),
            audio_tx: Some(tx),
            last_frame: Arc::new(Mutex::new(None)),
            started: Instant::now(),
            on_ended: Arc::new(|r| println!("ended: {r}")),
        };
        let mut handle = platform::start_capture(
            &window.id,
            CaptureOptions { max_width: 1920, max_height: 1080, fps: 30, audio: true },
            sink.clone(),
        )
        .expect("start capture");
        std::thread::sleep(Duration::from_secs(3));
        handle.stop();

        let last = sink.last_frame.lock().unwrap();
        if let Some(f) = last.as_ref() {
            frames.fetch_add(1, Ordering::Relaxed);
            println!("video: last frame {}x{}", f.width, f.height);
        }
        let mut audio_samples = 0;
        while let Ok(s) = rx.try_recv() {
            audio_samples += s.len();
        }
        println!("audio: {} samples (~{:.1}s stereo 48k)", audio_samples, audio_samples as f64 / 96_000.0);
        assert!(frames.load(Ordering::Relaxed) > 0, "no video frames captured");
    }
}
