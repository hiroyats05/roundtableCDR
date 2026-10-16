//! macOS capture via ScreenCaptureKit.
//!
//! Video and audio run as two streams: one filtered to the chosen window/display
//! for video, and (for windows) one filtered to just the owning application for
//! audio. Filtering audio by application is what keeps everything else (including
//! this app's own call audio) out of the shared sound.

use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;
use screencapturekit::screenshot_manager::SCScreenshotManager;

use super::{fit_within, thumbnail_data_url, CaptureHandle, CaptureOptions, CaptureSourceInfo, FrameSink};

const PERMISSION_HINT: &str =
    "Sem permissão de Gravação de Tela. Libere o app em Ajustes do Sistema → Privacidade e Segurança → Gravação de Tela e abra o app de novo.";

/// Windows smaller than this are toolbars, popovers and the like.
const MIN_WINDOW_SIZE: f64 = 120.0;

/// ScreenCaptureKit reports frames in points; capture at Retina resolution.
const BACKING_SCALE: f64 = 2.0;

fn shareable_content() -> Result<SCShareableContent, String> {
    SCShareableContent::get().map_err(|e| format!("{PERMISSION_HINT} ({e})"))
}

fn thumbnail(filter: &SCContentFilter, width: f64, height: f64) -> Option<String> {
    let (w, h) = fit_within((width * BACKING_SCALE) as u32, (height * BACKING_SCALE) as u32, 480, 300);
    let config = SCStreamConfiguration::new()
        .with_width(w)
        .with_height(h)
        .with_pixel_format(PixelFormat::BGRA)
        .with_shows_cursor(false);
    let sample = SCScreenshotManager::capture_sample_buffer(filter, &config).ok()?;
    let pixel_buffer = sample.pixel_buffer()?;
    let guard = pixel_buffer.lock(CVPixelBufferLockFlags::READ_ONLY).ok()?;
    let data = unsafe { guard.as_slice() }?;
    thumbnail_data_url(data, guard.bytes_per_row(), guard.width() as u32, guard.height() as u32)
}

pub fn list_sources() -> Result<Vec<CaptureSourceInfo>, String> {
    let content = shareable_content()?;
    let my_pid = std::process::id() as i32;
    let mut sources = Vec::new();

    for (i, display) in content.displays().iter().enumerate() {
        let frame = display.frame();
        let filter = SCContentFilter::create().with_display(display).with_excluding_windows(&[]).build().ok();
        sources.push(CaptureSourceInfo {
            id: format!("screen:{}", display.display_id()),
            kind: "screen",
            title: format!("Tela {}", i + 1),
            app_name: None,
            thumbnail: filter.and_then(|f| thumbnail(&f, frame.size.width, frame.size.height)),
        });
    }

    for window in content.windows() {
        let frame = window.frame();
        if !window.is_on_screen()
            || window.window_layer() != 0
            || frame.size.width < MIN_WINDOW_SIZE
            || frame.size.height < MIN_WINDOW_SIZE
        {
            continue;
        }
        let Some(app) = window.owning_application() else { continue };
        if app.process_id() == my_pid {
            continue;
        }
        let app_name = app.application_name();
        let title = window.title().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| app_name.clone());
        let filter = SCContentFilter::create().with_window(&window).build().ok();

        sources.push(CaptureSourceInfo {
            id: format!("window:{}", window.window_id()),
            kind: "window",
            title,
            app_name: Some(app_name),
            thumbnail: filter.and_then(|f| thumbnail(&f, frame.size.width, frame.size.height)),
        });
    }

    Ok(sources)
}

struct VideoOutput {
    sink: FrameSink,
}

impl SCStreamOutputTrait for VideoOutput {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Screen) {
            return;
        }
        // Idle/unchanged frames come without a pixel buffer.
        let Some(pixel_buffer) = sample.pixel_buffer() else { return };
        let Ok(guard) = pixel_buffer.lock(CVPixelBufferLockFlags::READ_ONLY) else { return };
        if guard.plane_count() < 2 {
            return;
        }
        let (Some(y_ptr), Some(uv_ptr)) = (guard.base_address_of_plane(0), guard.base_address_of_plane(1)) else {
            return;
        };
        let width = guard.width() as u32;
        let height = guard.height() as u32;
        let stride_y = guard.bytes_per_row_of_plane(0);
        let stride_uv = guard.bytes_per_row_of_plane(1);
        let y = unsafe { std::slice::from_raw_parts(y_ptr, stride_y * guard.height_of_plane(0)) };
        let uv = unsafe { std::slice::from_raw_parts(uv_ptr, stride_uv * guard.height_of_plane(1)) };
        self.sink.push_nv12(width, height, y, stride_y as u32, uv, stride_uv as u32);
    }
}

struct AudioOutput {
    sink: FrameSink,
}

impl SCStreamOutputTrait for AudioOutput {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Audio) {
            return;
        }
        let Ok(list) = sample.audio_buffer_list() else { return };
        let frames = sample.num_samples().max(0) as usize;
        if frames == 0 {
            return;
        }

        let to_i16 = |s: f32| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        let read_f32 = |bytes: &[u8], i: usize| {
            bytes.get(i * 4..i * 4 + 4).map(|b| f32::from_ne_bytes([b[0], b[1], b[2], b[3]])).unwrap_or(0.0)
        };

        let mut out = Vec::with_capacity(frames * 2);
        match list.num_buffers() {
            // Non-interleaved: one Float32 buffer per channel (ScreenCaptureKit's default).
            n if n >= 2 => {
                let (Some(left), Some(right)) = (list.buffer(0), list.buffer(1)) else { return };
                for i in 0..frames {
                    out.push(to_i16(read_f32(left.data(), i)));
                    out.push(to_i16(read_f32(right.data(), i)));
                }
            }
            1 => {
                let Some(buffer) = list.buffer(0) else { return };
                let channels = (buffer.data_byte_size() / 4 / frames).max(1);
                for i in 0..frames {
                    let l = read_f32(buffer.data(), i * channels);
                    let r = if channels > 1 { read_f32(buffer.data(), i * channels + 1) } else { l };
                    out.push(to_i16(l));
                    out.push(to_i16(r));
                }
            }
            _ => return,
        }
        self.sink.push_audio(out);
    }
}

struct EndedDelegate {
    sink: FrameSink,
}

impl SCStreamDelegateTrait for EndedDelegate {
    fn did_stop_with_error(&self, error: SCError) {
        self.sink.ended(format!("A captura parou: {error}"));
    }
}

struct MacCapture {
    streams: Vec<SCStream>,
}

impl CaptureHandle for MacCapture {
    fn stop(&mut self) {
        for stream in self.streams.drain(..) {
            let _ = stream.stop_capture();
        }
    }
}

impl Drop for MacCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn start_capture(
    source_id: &str,
    options: CaptureOptions,
    sink: FrameSink,
) -> Result<Box<dyn CaptureHandle>, String> {
    let content = shareable_content()?;
    let (kind, id) = source_id.split_once(':').ok_or("Fonte inválida")?;
    let id: u32 = id.parse().map_err(|_| "Fonte inválida")?;

    let (video_filter, size, app) = match kind {
        "screen" => {
            let display = content.displays().into_iter().find(|d| d.display_id() == id).ok_or("Tela não encontrada")?;
            let frame = display.frame();
            let filter = SCContentFilter::create()
                .with_display(&display)
                .with_excluding_windows(&[])
                .build()
                .map_err(|e| e.to_string())?;
            (filter, (frame.size.width, frame.size.height), None)
        }
        "window" => {
            let window = content
                .windows()
                .into_iter()
                .find(|w| w.window_id() == id)
                .ok_or("A janela não está mais aberta")?;
            let frame = window.frame();
            let filter = SCContentFilter::create().with_window(&window).build().map_err(|e| e.to_string())?;
            (filter, (frame.size.width, frame.size.height), window.owning_application())
        }
        _ => return Err("Fonte inválida".into()),
    };

    let (width, height) = fit_within(
        (size.0 * BACKING_SCALE) as u32,
        (size.1 * BACKING_SCALE) as u32,
        options.max_width,
        options.max_height,
    );
    let video_config = SCStreamConfiguration::new()
        .with_width(width)
        .with_height(height)
        .with_pixel_format(PixelFormat::YCbCr_420v)
        .with_fps(options.fps)
        .with_shows_cursor(true)
        .with_queue_depth(5);

    let mut video_stream =
        SCStream::new_with_delegate(&video_filter, &video_config, EndedDelegate { sink: sink.clone() })
            .map_err(|e| e.to_string())?;
    video_stream
        .add_output_handler(VideoOutput { sink: sink.clone() }, SCStreamOutputType::Screen)
        .map_err(|e| e.to_string())?;
    video_stream.start_capture().map_err(|e| format!("{PERMISSION_HINT} ({e})"))?;

    let mut streams = vec![video_stream];

    if options.audio && sink.has_audio() {
        if let (Some(app), Some(display)) = (app, content.displays().into_iter().next()) {
            let audio_filter = SCContentFilter::create()
                .with_display(&display)
                .with_including_applications(&[&app], &[])
                .build()
                .map_err(|e| e.to_string())?;
            // ScreenCaptureKit always produces video; keep it tiny and slow.
            let audio_config = SCStreamConfiguration::new()
                .with_width(2)
                .with_height(2)
                .with_fps(1)
                .with_captures_audio(true)
                .with_excludes_current_process_audio(true)
                .with_sample_rate(super::AUDIO_SAMPLE_RATE as i32)
                .with_channel_count(super::AUDIO_CHANNELS as i32);
            let mut audio_stream = SCStream::new(&audio_filter, &audio_config).map_err(|e| e.to_string())?;
            audio_stream
                .add_output_handler(AudioOutput { sink: sink.clone() }, SCStreamOutputType::Audio)
                .map_err(|e| e.to_string())?;
            audio_stream.start_capture().map_err(|e| e.to_string())?;
            streams.push(audio_stream);
        }
    }

    Ok(Box::new(MacCapture { streams }))
}
