"""Gap-triggered source discovery (Phase 6 follow-up: item 4 of the
gap-resolution rollout) - a manually-triggered, per-gap-row search for a
real source document that would answer a question the chat couldn't
confidently answer. Deliberately NOT the same mechanism as
region_contact_discovery.py's domain-guess-and-scrape approach: that
pipeline only ever finds a municipality's phone number by guessing a small
set of URL patterns, which can't locate "the law that answers this specific
question" the way a real search can. This uses OpenAI's Responses API
web_search tool instead, restricted to a small, per-vertical allowlist of
known authoritative Greek government/legal domains so results stay on-topic
rather than an open web search.

Every call here is a single admin-triggered action, never a background loop
- see KNOWN_DECISIONS.md-adjacent reasoning in the region-contact-discovery
pilot: automate only once there's real data on how often the manual version
finds a good, confirmable source."""

from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from openai import OpenAI

from app.config import settings

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client


# Known authoritative domains per vertical - the "targeted search against
# known authoritative sources" the discovery action restricts itself to,
# instead of an open web search. Format per OpenAI's filters.allowed_domains
# requirement: no protocol prefix, subdomains included automatically.
#
# taxheaven.gr and lawspot.gr added the same night George (a real domain
# expert) reported a real gap: e-nomothesia.gr's copy of Ν.4067/2012 (ΝΟΚ)
# is indexed at whole-document granularity only, so web_search can't cite a
# specific article from it - a fencing-height question needing Άρθρο 17 §1
# came back empty. Reproduced live: the identical search with taxheaven.gr
# added found that exact article (taxheaven.gr/law/4067/2012/arthro/17/
# paragrafos/1), confirming the allowlist, not the search mechanism, was
# the cause. lawspot.gr added on separate, independent evidence - it's
# already the real source of 37 active documents in production (36
# tax_accounting, 1 construction), so it was already implicitly trusted by
# this system, just never added here. Both domains added to both verticals
# since taxheaven.gr covers general legislation beyond tax topics (its name
# notwithstanding - confirmed by the construction-law citation above) and
# lawspot.gr already backs documents in both. kodiko.gr/nomotelia.gr/
# dsanet.gr were considered too (also reputable Greek legal-reference
# sites) but not added - no concrete evidence (an existing document, or a
# real search reproduction) supports them the way it does for these two;
# revisit if/when such evidence turns up rather than adding on reputation
# alone.
AUTHORITATIVE_DOMAINS: dict[str, list[str]] = {
    "construction": ["e-nomothesia.gr", "et.gr", "ypen.gov.gr", "tee.gr", "ktimatologio.gr", "taxheaven.gr", "lawspot.gr"],
    "tax_accounting": ["e-nomothesia.gr", "et.gr", "aade.gr", "minfin.gr", "efka.gov.gr", "taxheaven.gr", "lawspot.gr"],
}
_DEFAULT_DOMAINS = ["e-nomothesia.gr", "et.gr"]

# Coarse mapping from a cited domain to the app's existing authority-slug
# convention (see Document.authority's comment in models.py) - purely a
# display label, not access control, so an unrecognized domain safely falls
# back to 'other' rather than failing.
_AUTHORITY_BY_DOMAIN: dict[str, str] = {
    "aade.gr": "aade",
    "efka.gov.gr": "efka",
    "ypen.gov.gr": "ypen",
    "ktimatologio.gr": "ktimatologio",
    "tee.gr": "tee",
}


def _domain_of(url: str) -> str:
    return urlparse(url).netloc.removeprefix("www.")


# Tracking params the web_search tool appends to cited URLs (e.g.
# ?utm_source=openai) - stripped before storing, since this becomes a real
# citation URL shown to users, not an internal-only reference.
_TRACKING_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"}


def _strip_tracking_params(url: str) -> str:
    parsed = urlparse(url)
    kept = [(k, v) for k, v in parse_qsl(parsed.query) if k not in _TRACKING_PARAMS]
    return urlunparse(parsed._replace(query=urlencode(kept)))


class GapDiscoveryError(Exception):
    """A genuine failure to complete the search (API error, no client
    configured) - distinct from a clean "nothing found" outcome, which
    returns None rather than raising."""


def discover_source_candidate(question: str, vertical_slug: str | None) -> dict | None:
    """Runs one web-search call restricted to known authoritative domains
    for the given vertical, looking for a source that answers `question`.
    Returns a candidate dict {title, content, source_url, authority,
    confidence} or None if no confident, cited answer was found. Raises
    GapDiscoveryError only for a genuine API failure - the caller decides
    how to surface that (currently: a 502 from the triggering endpoint)."""
    if not settings.openai_api_key:
        raise GapDiscoveryError("No OPENAI_API_KEY configured")

    domains = AUTHORITATIVE_DOMAINS.get(vertical_slug or "", _DEFAULT_DOMAINS)
    client = _get_client()
    try:
        response = client.responses.create(
            model=settings.chat_model,
            tools=[{"type": "web_search", "filters": {"allowed_domains": domains}}],
            input=(
                "Βρες την πιο έγκυρη πηγή (νόμος, εγκύκλιος, ή επίσημη οδηγία) που "
                "απαντά στην ακόλουθη ερώτηση χρήστη μιας ελληνικής πλατφόρμας "
                "κανονιστικής συμμόρφωσης. Απάντησε στα Ελληνικά, σύντομα και "
                "συγκεκριμένα, με βάση ΜΟΝΟ ό,τι βρεις στις επιτρεπόμενες πηγές. Αν "
                "δεν βρεις καμία αξιόπιστη πηγή, πες ρητά ότι δεν βρέθηκε τίποτα "
                f"αξιόπιστο.\n\nΕρώτηση: {question}"
            ),
        )
    except Exception as exc:
        raise GapDiscoveryError(str(exc)) from exc

    text = (response.output_text or "").strip()
    citations = _extract_citations(response)
    if not citations or not text:
        return None

    primary = citations[0]
    domain = _domain_of(primary["url"])
    return {
        "title": primary.get("title") or question[:200],
        "content": text,
        "source_url": _strip_tracking_params(primary["url"]),
        "authority": _AUTHORITY_BY_DOMAIN.get(domain, "other"),
        # More than one distinct citation backing the answer reads as
        # stronger than a single lone source - a coarse, honest signal,
        # not a calibrated probability.
        "confidence": "high" if len({c["url"] for c in citations}) > 1 else "medium",
    }


def _extract_citations(response) -> list[dict]:
    citations: list[dict] = []
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", None) != "message":
            continue
        for block in getattr(item, "content", None) or []:
            for ann in getattr(block, "annotations", None) or []:
                if getattr(ann, "type", None) == "url_citation":
                    citations.append({"url": ann.url, "title": getattr(ann, "title", None)})
    return citations
