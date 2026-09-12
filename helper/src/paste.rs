// Gir Guild Wars 2-vinduet fokus og limer inn utklippstavla i chatten (Enter, Ctrl+V).
// Sender ikke meldingen; spilleren trykker Enter selv. Skriver OK, NOGAME, NOFOCUS eller FOUND <hwnd>.

use std::thread::sleep;
use std::time::Duration;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_CONTROL, VK_MENU, VK_RETURN};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

const VK_V: u16 = 0x56;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn find_gw2() -> HWND {
    unsafe {
        let class = wide("ArenaNet_Gr_Window_Class");
        let mut hwnd = FindWindowW(class.as_ptr(), std::ptr::null());
        if hwnd.is_null() {
            let title = wide("Guild Wars 2");
            hwnd = FindWindowW(std::ptr::null(), title.as_ptr());
        }
        hwnd
    }
}

fn key(vk: u16, up: bool) {
    unsafe { keybd_event(vk as u8, 0, if up { KEYEVENTF_KEYUP } else { 0 }, 0) };
}

fn focus(hwnd: HWND) -> bool {
    unsafe {
        // Windows nekter SetForegroundWindow fra bakgrunnsprosesser; Alt-trykket er det kjente unntaket
        key(VK_MENU, false);
        key(VK_MENU, true);
        let fg = GetForegroundWindow();
        let tid_fg = GetWindowThreadProcessId(fg, std::ptr::null_mut());
        let tid_me = GetCurrentThreadId();
        AttachThreadInput(tid_me, tid_fg, 1);
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
        AttachThreadInput(tid_me, tid_fg, 0);
        for _ in 0..20 {
            if GetForegroundWindow() == hwnd {
                return true;
            }
            sleep(Duration::from_millis(20));
        }
        false
    }
}

pub fn run(args: &[String]) -> i32 {
    let no_enter = args.iter().any(|a| a == "--no-enter");
    let dry_run = args.iter().any(|a| a == "--dry-run");
    let hwnd = find_gw2();
    if hwnd.is_null() {
        println!("NOGAME");
        return 1;
    }
    if dry_run {
        println!("FOUND {}", hwnd as usize);
        return 0;
    }
    if !focus(hwnd) {
        println!("NOFOCUS");
        return 2;
    }
    sleep(Duration::from_millis(120));
    if !no_enter {
        key(VK_RETURN, false);
        key(VK_RETURN, true);
        sleep(Duration::from_millis(120));
    }
    key(VK_CONTROL, false);
    key(VK_V, false);
    key(VK_V, true);
    key(VK_CONTROL, true);
    println!("OK");
    0
}
