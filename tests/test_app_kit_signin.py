"""app_kit.signin: a site signed in to in a Chrome window of its own -- its cookies read through Chrome's DevTools pipe
until the app's check finds the sign-in, then the window closed. Run in a headless Chrome, against a page here that
"signs in" by setting a cookie; skipped where no Chrome is installed."""
import http.server
import os
import tempfile
import threading
import time
import unittest
from unittest import mock

from app_kit import signin


class _Site(http.server.BaseHTTPRequestHandler):
    def do_GET(self):                                # noqa: N802 - http.server's name
        self.send_response(200)
        if self.path.startswith("/login"):           # a visitor's cookie, then the page "signs in" a moment later
            self.send_header("Set-Cookie", "sess=anon; Path=/")
            body = b"<script>setTimeout(() => location = '/signed', 300)</script>"
        else:
            self.send_header("Set-Cookie", "sess=signed-in-value; Path=/; HttpOnly")
            body = b"signed in"
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


@unittest.skipUnless(signin.executable(), "no Chrome here")
class SignInTest(unittest.TestCase):
    def setUp(self):
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Site)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.shutdown)
        self.profile = tempfile.mkdtemp()

    def wait(self, s, timeout=30):
        deadline = time.time() + timeout
        while s.state == "open" and time.time() < deadline:
            time.sleep(0.1)

    def test_the_sign_in_is_found_in_the_window_s_cookies_and_the_window_closed(self):
        seen = []

        def check(cookies):
            seen.append(sorted(c["value"] for c in cookies))
            got = [c["value"] for c in cookies if c["name"] == "sess" and c["value"] != "anon"]
            return got[0] if got else None
        s = signin.SignIn(f"http://127.0.0.1:{self.server.server_port}/login", self.profile, check,
                          args=["--headless=new"]).start()
        self.wait(s)
        self.assertEqual((s.state, s.got), ("done", "signed-in-value"))   # an HttpOnly cookie, read all the same
        self.assertEqual(len(seen), len(set(map(tuple, seen))))           # asked again only as the cookies changed
        s.proc.wait(10)
        self.assertIsNotNone(s.proc.poll())                               # its Chrome gone
        self.assertTrue(os.path.isdir(self.profile))                      # its profile kept, for next time

    def test_given_up_on_it_is_closed(self):
        s = signin.SignIn(f"http://127.0.0.1:{self.server.server_port}/login", self.profile, lambda c: None,
                          args=["--headless=new"]).start()
        time.sleep(1.5)
        s.close()
        self.assertEqual(s.state, "closed")
        s.proc.wait(10)
        self.assertIsNotNone(s.proc.poll())

    def test_no_chrome_is_said(self):
        with mock.patch.object(signin, "executable", return_value=None), \
                self.assertRaisesRegex(signin.SignInError, "install Google Chrome"):
            signin.SignIn("http://x/", self.profile, lambda c: None).start()


if __name__ == "__main__":
    unittest.main()
