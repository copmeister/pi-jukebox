"""Content-addressed artwork cache stored under runtime data."""

import hashlib
from pathlib import Path

from pi_jukebox.catalogue.database import Catalogue
from pi_jukebox.catalogue.models import ArtworkData

MIME_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


class ArtworkCache:
    """Persist deduplicated embedded images without touching source music."""

    def __init__(self, directory: Path, catalogue: Catalogue) -> None:
        self.directory = directory
        self.catalogue = catalogue

    def store(self, artwork: ArtworkData) -> int:
        content_hash = hashlib.sha256(artwork.content).hexdigest()
        requested_mime_type = artwork.mime_type.casefold()
        mime_type = (
            requested_mime_type
            if requested_mime_type in MIME_EXTENSIONS
            else "application/octet-stream"
        )
        extension = MIME_EXTENSIONS.get(mime_type, ".bin")
        filename = f"{content_hash}{extension}"
        self.directory.mkdir(parents=True, exist_ok=True)
        cache_path = self.directory / filename
        if not cache_path.exists():
            cache_path.write_bytes(artwork.content)
        return self.catalogue.add_artwork(
            content_hash=content_hash,
            mime_type=mime_type,
            cache_filename=filename,
            byte_size=len(artwork.content),
        )

    def remove(self, filenames: list[str]) -> None:
        root = self.directory.resolve()
        for filename in filenames:
            candidate = (self.directory / filename).resolve()
            if candidate.parent == root:
                candidate.unlink(missing_ok=True)
