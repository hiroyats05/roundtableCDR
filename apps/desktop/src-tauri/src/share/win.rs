//! Windows capture: WebRTC's DesktopCapturer for video and WASAPI process
//! loopback for audio.
//!
//! A window's source id is its HWND, which gives us the owning process. WASAPI's
//! process loopback then captures audio from that process tree only (browsers
//! play audio from child processes, hence the tree), so nothing else on the
//! machine — including this app's own call audio — ends up in the share.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use livekit::webrtc::desktop_capturer::{
    CaptureError, CaptureSource, DesktopCapturer, DesktopCapturerOptions, DesktopCaptureSourceType,
};
use ::windows::core::PWSTR;
use ::windows::Win32::Foundation::{CloseHandle, HWND};
use ::windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use ::windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

use super::{thumbnail_data_url, CaptureHandle, CaptureOptions, CaptureSourceInfo, FrameSink};

fn window_pid(id: u64) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(HWND(id as usize as *mut _), Some(&mut pid)) };
    pid
}

fn process_name(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let result = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(handle);
        result.ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let file = path.rsplit('\\').next()?.to_string();
        Some(file.trim_end_matches(".exe").trim_end_matches(".EXE").to_string())
    }
}

fn capturer(kind: DesktopCaptureSourceType) -> Option<DesktopCapturer> {
    let mut options = DesktopCapturerOptions::new(kind);
    options.set_include_cursor(true);
    DesktopCapturer::new(options)
}

/// Grab a single frame of a source for the picker.
fn thumbnail(kind: DesktopCaptureSourceType, source: CaptureSource) -> Option<String> {
    let mut capturer = capturer(kind)?;
    let result: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let slot = result.clone();
    capturer.start_capture(Some(source), move |frame| {
        if let Ok(frame) = frame {
            let thumb = thumbnail_data_url(frame.data(), frame.stride() as usize, frame.width() as u32, frame.height() as u32);
            *slot.lock().unwrap() = thumb;
        }
    });
    // The first frames can come back as temporary errors while capture warms up.
    for _ in 0..5 {
        capturer.capture_frame();
        if result.lock().unwrap().is_some() {
            break;
        }
        thread::sleep(Duration::from_millis(40));
    }
    let thumb = result.lock().unwrap().take();
    thumb
}

pub fn list_sources() -> Result<Vec<CaptureSourceInfo>, String> {
    let my_pid = std::process::id();
    let mut sources = Vec::new();

    if let Some(screens) = capturer(DesktopCaptureSourceType::Screen) {
        for (i, source) in screens.get_source_list().into_iter().enumerate() {
            sources.push(CaptureSourceInfo {
                id: format!("screen:{}", source.id()),
                kind: "screen",
                title: format!("Tela {}", i + 1),
                app_name: None,
                thumbnail: thumbnail(DesktopCaptureSourceType::Screen, source),
            });
        }
    }

    if let Some(windows) = capturer(DesktopCaptureSourceType::Window) {
        for source in windows.get_source_list() {
            let title = source.title();
            let pid = window_pid(source.id());
            if title.trim().is_empty() || pid == my_pid || pid == 0 {
                continue;
            }
            sources.push(CaptureSourceInfo {
                id: format!("window:{}", source.id()),
                kind: "window",
                title,
                app_name: process_name(pid),
                thumbnail: thumbnail(DesktopCaptureSourceType::Window, source),
            });
        }
    }

    Ok(sources)
}

struct WinCapture {
    stop: Arc<AtomicBool>,
    threads: Vec<thread::JoinHandle<()>>,
}

impl CaptureHandle for WinCapture {
    fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

impl Drop for WinCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn start_capture(
    source_id: &str,
    options: CaptureOptions,
    sink: FrameSink,
) -> Result<Box<dyn CaptureHandle>, String> {
    let (kind, id) = source_id.split_once(':').ok_or("Fonte inválida")?;
    let id: u64 = id.parse().map_err(|_| "Fonte inválida")?;
    let kind = match kind {
        "screen" => DesktopCaptureSourceType::Screen,
        "window" => DesktopCaptureSourceType::Window,
        _ => return Err("Fonte inválida".into()),
    };

    let stop = Arc::new(AtomicBool::new(false));
    let mut threads = Vec::new();

    // DesktopCapturer isn't Send, so it lives entirely on its own thread; the
    // channel reports whether startup worked.
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let video_stop = stop.clone();
    let video_sink = sink.clone();
    let max = (options.max_width, options.max_height);
    let frame_interval = Duration::from_secs_f64(1.0 / options.fps.max(1) as f64);
    threads.push(thread::spawn(move || {
        let Some(mut capturer) = capturer(kind) else {
            let _ = ready_tx.send(Err("Não foi possível iniciar a captura de tela".into()));
            return;
        };
        let Some(source) = capturer.get_source_list().into_iter().find(|s| s.id() == id) else {
            let _ = ready_tx.send(Err("A janela não está mais aberta".into()));
            return;
        };

        let failed = Arc::new(AtomicBool::new(false));
        let failed_cb = failed.clone();
        let frame_sink = video_sink.clone();
        capturer.start_capture(Some(source), move |result| match result {
            Ok(frame) => frame_sink.push_bgra(
                frame.data(),
                frame.stride(),
                frame.width() as u32,
                frame.height() as u32,
                max,
            ),
            Err(CaptureError::Permanent) => failed_cb.store(true, Ordering::SeqCst),
            Err(CaptureError::Temporary) => {}
        });
        let _ = ready_tx.send(Ok(()));

        while !video_stop.load(Ordering::SeqCst) {
            let started = Instant::now();
            capturer.capture_frame();
            if failed.load(Ordering::SeqCst) {
                video_sink.ended("A janela foi fechada ou não pode mais ser capturada".into());
                break;
            }
            thread::sleep(frame_interval.saturating_sub(started.elapsed()));
        }
    }));

    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("A captura de tela não respondeu".into()),
    }

    if options.audio && sink.has_audio() && kind == DesktopCaptureSourceType::Window {
        let pid = window_pid(id);
        let audio_stop = stop.clone();
        let audio_sink = sink.clone();
        threads.push(thread::spawn(move || {
            if let Err(e) = capture_process_audio(pid, &audio_stop, &audio_sink) {
                log::warn!("process audio capture failed: {e}");
            }
        }));
    }

    Ok(Box::new(WinCapture { stop, threads }))
}

fn capture_process_audio(pid: u32, stop: &AtomicBool, sink: &FrameSink) -> Result<(), Box<dyn std::error::Error>> {
    use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat};

    wasapi::initialize_mta().ok()?;
    let format = WaveFormat::new(
        16,
        16,
        &SampleType::Int,
        super::AUDIO_SAMPLE_RATE as usize,
        super::AUDIO_CHANNELS as usize,
        None,
    );
    let mut client = AudioClient::new_application_loopback_client(pid, true)?;
    client.initialize_client(
        &format,
        &Direction::Capture,
        &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 },
    )?;
    let event = client.set_get_eventhandle()?;
    let capture = client.get_audiocaptureclient()?;
    let mut queue: VecDeque<u8> = VecDeque::new();
    client.start_stream()?;

    while !stop.load(Ordering::SeqCst) {
        // No events while the app is silent; just keep waiting.
        if event.wait_for_event(200).is_err() {
            continue;
        }
        while capture.get_next_packet_size()?.unwrap_or(0) > 0 {
            capture.read_from_device_to_deque(&mut queue)?;
        }
        let usable = queue.len() & !1;
        if usable == 0 {
            continue;
        }
        let bytes: Vec<u8> = queue.drain(..usable).collect();
        let samples = bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
        sink.push_audio(samples);
    }

    client.stop_stream()?;
    Ok(())
}
