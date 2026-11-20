"""app_kit.fileedit: a folder's files, each text file edited live -- the user, the actors and the file on disk together,
as the host shares them (app_kit.docs) -- and any other file shown, for an app built on it. The Files app is it alone;
the LaTeX editor is it with a LaTeX build and its PDF beside the file. What two apps share is a library, never one
app's code (DESIGN.md, "Panels"), so it is here, apart from both:

    backend.py    FileEdit: the App an app's backend subclasses -- its panel's requests (edit/..., mode, branches,
                  files/changes), its mode, its agents' file tools (<app>_read, _edit, _write, _open) and the guard on
                  their own edit tools
    chooser.py    the system's Open dialog and file manager, on the host's machine
    panel/        the panel's code, which an app's panel loads from the host (/_ag/lib/fileedit/..., the dashboard's
                  libs.py): page.js, editor*.js, recent.js, plain.js, start.js -- ES modules, which the app's own
                  module (its panel's entry) imports -- editor.css, panel.css, and vendor/editor.js (CodeMirror and
                  Yjs, built by assets/src/editor). The app's module gives its own parts to edAdd (editor.js), then
                  starts the panel (start.js's edStart)
"""

from .backend import MODES, FileEdit  # noqa: F401 - the package's API
