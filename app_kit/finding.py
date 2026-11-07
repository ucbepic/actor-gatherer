"""Where apps are, for every host that looks for them (the dashboard's app_host.py, ag's catalog of pollers): each a
folder holding an app.toml, in these, in order -- an app found in a later one wins its name:

    BUILTIN          the apps that come with ag (apps/ beside this package)
    AG_APPS_PATH     folders named in it, os.pathsep apart
    <home>/apps/     the home's own: what `ag apps install` puts there

    search_path(home)   those folders
    find(home)          ({name: Manifest}, {folder: why it can't be read}) of every app in them

Standard library only."""

import os
from typing import Dict, List, Tuple

from .manifest import FILE, Manifest, ManifestError, load

BUILTIN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "apps")
PATH_ENV = "AG_APPS_PATH"


def search_path(home: str) -> List[str]:
    given = [p for p in os.environ.get(PATH_ENV, "").split(os.pathsep) if p]
    return [BUILTIN, *given, os.path.join(home, "apps")]


def find(home: str) -> Tuple[Dict[str, Manifest], Dict[str, str]]:
    found: Dict[str, Manifest] = {}
    broken: Dict[str, str] = {}
    for root in search_path(home):
        if not os.path.isdir(root):
            continue
        for entry in sorted(os.listdir(root)):
            folder = os.path.join(root, entry)
            if not os.path.isfile(os.path.join(folder, FILE)):
                continue
            try:
                m = load(folder)
            except ManifestError as exc:
                broken[folder] = str(exc)
                continue
            found[m.name] = m
    return found, broken
