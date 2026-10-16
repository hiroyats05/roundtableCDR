fn main() {
    // screencapturekit's Swift bridge auto-links Swift back-compat libraries.
    // Their default search path only exists with a full Xcode install, so point
    // the linker at the active toolchain's Swift libs (also works with just the
    // Command Line Tools).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        if let Ok(out) = std::process::Command::new("xcrun").args(["--find", "swiftc"]).output() {
            let swiftc = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if let Some(bin) = std::path::Path::new(&swiftc).parent() {
                let lib = bin.join("../lib/swift/macosx");
                if lib.exists() {
                    println!("cargo:rustc-link-search=native={}", lib.display());
                }
            }
        }
    }

    tauri_build::build()
}
