# Gir Guild Wars 2-vinduet fokus og limer inn utklippstavla i chatten (Enter, Ctrl+V).
# Sender ikke meldingen; spilleren trykker Enter selv. Bruk: sendchat.py [--no-enter] [--dry-run]
import sys, time, ctypes
from ctypes import wintypes

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

VK_RETURN, VK_CONTROL, VK_V, VK_MENU = 0x0D, 0x11, 0x56, 0x12
KEYEVENTF_KEYUP = 0x0002

def find_gw2():
    hwnd = user32.FindWindowW("ArenaNet_Gr_Window_Class", None)
    if not hwnd:
        hwnd = user32.FindWindowW(None, "Guild Wars 2")
    return hwnd

def key(vk, up=False):
    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP if up else 0, 0)

def focus(hwnd):
    # Windows nekter SetForegroundWindow fra bakgrunnsprosesser; Alt-trykket er det kjente unntaket
    key(VK_MENU); key(VK_MENU, True)
    fg = user32.GetForegroundWindow()
    tid_fg = user32.GetWindowThreadProcessId(fg, None)
    tid_me = kernel32.GetCurrentThreadId()
    user32.AttachThreadInput(tid_me, tid_fg, True)
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    user32.AttachThreadInput(tid_me, tid_fg, False)
    for _ in range(20):
        if user32.GetForegroundWindow() == hwnd:
            return True
        time.sleep(0.02)
    return False

def main():
    args = set(sys.argv[1:])
    hwnd = find_gw2()
    if not hwnd:
        print("NOGAME"); return 1
    if "--dry-run" in args:
        print("FOUND", hwnd); return 0
    if not focus(hwnd):
        print("NOFOCUS"); return 2
    time.sleep(0.12)
    if "--no-enter" not in args:
        key(VK_RETURN); key(VK_RETURN, True)
        time.sleep(0.12)
    key(VK_CONTROL); key(VK_V); key(VK_V, True); key(VK_CONTROL, True)
    print("OK"); return 0

if __name__ == "__main__":
    sys.exit(main())
