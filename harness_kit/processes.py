"""Processes, on every OS. Here so that ag's integrations (the hook servers' records, Antigravity's `told` files) and
the dashboard share one copy without either importing the other.

    running(pid)            whether any process has that pid now: True or False (False for a pid that is no number)
    end_group(pid, force)   a process started in a group of its own, and all it started, ended
    using(paths)            Windows: the processes that have any of the files open (elsewhere lsof or /proc tell it)
    started_as(pid)         Windows: when a process started, and its command line (elsewhere ps tells it)"""

import os
import signal
import subprocess
from typing import Iterable, Optional, Set, Tuple

EPOCH_AS_FILETIME = 116444736000000000         # 1970-01-01 in Windows' 100 ns ticks since 1601


def end_group(pid: int, force: bool = False) -> None:
    """The process `pid`, started with start_new_session=True, and all it started: asked to end, or with `force` made
    to. ProcessLookupError when there is none. Windows has no process groups (and no asking a program with no window),
    so there the tree of what it started is ended at once."""
    if os.name != "nt":
        os.killpg(pid, signal.SIGKILL if force else signal.SIGTERM)
        return
    try:
        done = subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        raise ProcessLookupError(pid) from None
    if done.returncode:
        raise ProcessLookupError(pid)


def running(pid) -> bool:
    """Whether a process with `pid` runs now. On POSIX, signal 0 asks without sending anything. Windows has no
    signal 0 (os.kill raises a bare OSError, WinError 87, for a pid that is gone), so there the process is opened
    and its exit code read."""
    try:
        pid = int(pid)
    except (ValueError, TypeError):
        return False
    if os.name == "nt":
        return _running_windows(pid)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:                  # it runs, as another user
        return True
    return True


def _running_windows(pid: int) -> bool:
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    handle = kernel32.OpenProcess(0x1000, False, pid)        # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return ctypes.get_last_error() == 5                  # ERROR_ACCESS_DENIED: it runs, as another user
    try:
        code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return False
        return code.value == 259                             # STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def using(paths: Iterable[str]) -> Optional[Set[int]]:
    """The pids of the processes that have any of `paths` open, by Windows' Restart Manager (in every Windows since
    Vista, for any user's own processes); None when that can't be told: elsewhere, or when the Restart Manager fails."""
    if os.name != "nt":
        return None
    paths = [os.path.abspath(p) for p in paths]
    if not paths:
        return set()
    import ctypes
    from ctypes import wintypes

    class Unique(ctypes.Structure):
        _fields_ = [("pid", wintypes.DWORD), ("started", wintypes.FILETIME)]

    class Info(ctypes.Structure):                                   # RM_PROCESS_INFO
        _fields_ = [("process", Unique), ("app", wintypes.WCHAR * 256), ("service", wintypes.WCHAR * 64),
                    ("kind", ctypes.c_int), ("status", wintypes.ULONG), ("session", wintypes.DWORD),
                    ("restartable", wintypes.BOOL)]

    try:
        rm = ctypes.WinDLL("rstrtmgr")
    except OSError:
        return None
    rm.RmStartSession.argtypes = (ctypes.POINTER(wintypes.DWORD), wintypes.DWORD, wintypes.LPWSTR)
    rm.RmRegisterResources.argtypes = (wintypes.DWORD, wintypes.UINT, ctypes.POINTER(wintypes.LPCWSTR),
                                       wintypes.UINT, ctypes.c_void_p, wintypes.UINT, ctypes.c_void_p)
    rm.RmGetList.argtypes = (wintypes.DWORD, ctypes.POINTER(wintypes.UINT), ctypes.POINTER(wintypes.UINT),
                             ctypes.POINTER(Info), ctypes.POINTER(wintypes.DWORD))
    rm.RmEndSession.argtypes = (wintypes.DWORD,)
    session, key = wintypes.DWORD(), ctypes.create_unicode_buffer(33)   # CCH_RM_SESSION_KEY + 1
    if rm.RmStartSession(ctypes.byref(session), 0, key):
        return None
    try:
        files = (wintypes.LPCWSTR * len(paths))(*paths)
        if rm.RmRegisterResources(session, len(paths), files, 0, None, 0, None):
            return None
        room = 16
        for _ in range(5):
            needed, count, reasons = wintypes.UINT(), wintypes.UINT(room), wintypes.DWORD()
            infos = (Info * room)()
            err = rm.RmGetList(session, ctypes.byref(needed), ctypes.byref(count), infos, ctypes.byref(reasons))
            if err == 234:                                          # ERROR_MORE_DATA: more of them than room
                room = max(needed.value, room) + 8
                continue
            if err:
                return None
            return {infos[i].process.pid for i in range(count.value)}
        return None
    finally:
        rm.RmEndSession(session)


def started_as(pid: int) -> Optional[Tuple[float, str]]:
    """(when process `pid` started, in seconds since the epoch; its command line), or None when it has ended or
    can't be read. Windows only: elsewhere None."""
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes
    kernel32, ntdll = ctypes.WinDLL("kernel32", use_last_error=True), ctypes.WinDLL("ntdll")
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.GetProcessTimes.argtypes = (wintypes.HANDLE,) + (ctypes.POINTER(wintypes.FILETIME),) * 4
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    ntdll.NtQueryInformationProcess.restype = ctypes.c_long                 # an NTSTATUS: below 0, it failed
    ntdll.NtQueryInformationProcess.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.ULONG,
                                                ctypes.POINTER(wintypes.ULONG))

    class Text(ctypes.Structure):                                           # UNICODE_STRING
        _fields_ = [("length", wintypes.USHORT), ("room", wintypes.USHORT), ("buffer", ctypes.c_void_p)]

    handle = kernel32.OpenProcess(0x1000, False, int(pid))                   # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return None
    try:
        made, ended, kernel, user = (wintypes.FILETIME() for _ in range(4))
        if not kernel32.GetProcessTimes(handle, ctypes.byref(made), ctypes.byref(ended), ctypes.byref(kernel),
                                        ctypes.byref(user)):
            return None
        started = ((made.dwHighDateTime << 32 | made.dwLowDateTime) - EPOCH_AS_FILETIME) / 1e7
        size = wintypes.ULONG(0)
        ntdll.NtQueryInformationProcess(handle, 60, None, 0, ctypes.byref(size))   # ProcessCommandLineInformation:
        if not size.value:                                                          # how big it is, first
            return None
        buf = ctypes.create_string_buffer(size.value)
        if ntdll.NtQueryInformationProcess(handle, 60, buf, size, ctypes.byref(size)) < 0:
            return None
        text = Text.from_buffer(buf)
        return started, ctypes.wstring_at(text.buffer, text.length // 2) if text.buffer else ""
    finally:
        kernel32.CloseHandle(handle)
