"""Télécharge et publie un instantané complet, en lecture seule."""
import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.client import HTTPException
import json
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .normalize import ADAPTERS, InvalidData, normalize, validate_references

BASE_URL = "https://rest.fnar.net"
MAX_BYTES = 32 * 1024 * 1024
MAX_ATTEMPTS = 3
MIN_INTERVAL = 1.0
TIMEOUT = 25
MAX_RETRY_DELAY = 60


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def retry_after(value):
    if not value:
        return 0
    try:
        if value.isascii() and value.isdecimal():
            return int(value)
        return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
    except (TypeError, ValueError, OverflowError):
        return 0


def fetch_json(path, *, open_url=None, sleep=time.sleep):
    if open_url is None:
        open_url = build_opener(NoRedirect()).open
    request = Request(BASE_URL + path, headers={
        "Accept": "application/json", "User-Agent": "PRUN-Assistant/0.1 (public data reader)",
    })
    for attempt in range(MAX_ATTEMPTS):
        server_delay = 0
        try:
            with open_url(request, timeout=TIMEOUT) as response:
                if response.headers.get_content_type() != "application/json":
                    raise InvalidData(f"{path} : type de réponse inattendu")
                raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise InvalidData(f"{path} : réponse trop volumineuse")
            try:
                return json.loads(raw)
            except (UnicodeError, ValueError, RecursionError) as exc:
                raise InvalidData(f"{path} : JSON invalide") from exc
        except HTTPError as error:
            status = error.code
            server_delay = retry_after(error.headers.get("Retry-After"))
            error.close()
            if status not in (408, 429) and not 500 <= status <= 599:
                raise InvalidData(f"{path} : HTTP {status}") from error
            reason = f"HTTP {status}"
        except (URLError, OSError, HTTPException) as error:
            reason = f"connexion interrompue ({type(error).__name__})"
        if attempt + 1 == MAX_ATTEMPTS or server_delay > MAX_RETRY_DELAY:
            raise InvalidData(f"{path} : {reason}")
        delay = max(2 ** (attempt + 1), server_delay)
        print(f"{path} : {reason}, nouvel essai dans {delay:g} s", file=sys.stderr)
        sleep(delay)


def atomic_write(output, data):
    output.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(data, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            stream.write("\n")
            stream.close()
            temporary.replace(output)
        finally:
            temporary.unlink(missing_ok=True)


def collect(output, *, fetch=fetch_json, sleep=time.sleep):
    data = {}
    for section, (path, _, _) in ADAPTERS.items():
        if data:
            sleep(MIN_INTERVAL)
        data[section] = normalize(section, fetch(path))
        print(f"{path} : {len(data[section])} lignes validées")
    validate_references(data)
    data.update(source="fio", schemaVersion=1, collectedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    atomic_write(output, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("public/data/fio.json"))
    args = parser.parse_args()
    try:
        collect(args.output)
    except (InvalidData, OSError) as error:
        print(f"Échec de la collecte : {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
