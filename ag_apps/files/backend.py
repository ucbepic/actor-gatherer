"""The Files app (app.toml): a folder's files, any of them opened -- a text file edited plain, saved whole (FileEdit's
`edit/text` and `edit/put`: no live document, no mode, no conflicts), any other shown -- with which actors changed
which files lately, and where. All of it app_kit.fileedit's; its agents' one tool is files_open.

It takes over the Editor's instances (the app it was, before it and the LaTeX editor were made of it: `replaces`) that
the LaTeX editor does not want (a folder with no LaTeX source at its top: `takes_over`)."""

from app_kit.fileedit import FileEdit


class FilesApp(FileEdit):
    CALLED = "Files app"
    LIVE = False                    # plain: no mode, its folder's files changed by agents as on disk
