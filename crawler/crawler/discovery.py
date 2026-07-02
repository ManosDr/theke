"""Generic "find PDF links on a listing page" helper.

Works for plain server-rendered pages (ΥΠΕΝ, ΤΕΕ e-adeies) where documents
are linked directly as <a href="...pdf">. Sites that require session-based
search (et.gr) need their own discovery logic - see the ΦΕΚ-specific
module once that's built.
"""

from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

USER_AGENT = "thekebot/0.1 (construction compliance assistant; contact: manos.drams@gmail.com)"


def discover_pdf_links(page_url: str) -> list[dict]:
    resp = requests.get(page_url, timeout=30, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    seen: set[str] = set()
    links: list[dict] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if ".pdf" not in href.lower():
            continue
        url = urljoin(page_url, href)
        if url in seen:
            continue
        seen.add(url)
        title = a.get_text(strip=True) or url.rsplit("/", 1)[-1]
        links.append({"url": url, "title": title})
    return links
