#!/usr/bin/env python3
"""Import resume variants from a folder of existing PDF resumes into the app state.

This script extracts text from PDFs, parses resume sections heuristically, then creates
or updates resume objects through the local app API.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pypdf import PdfReader

API_BASE = "http://127.0.0.1:4100"
DEFAULT_SECTION_ORDER = ["education", "skills", "openSource", "projects", "experience"]
SECTION_TITLES = {
    "education": "Education",
    "skills": "Skills",
    "openSource": "Open Source Contributions",
    "projects": "Projects",
    "experience": "Experience",
}

MONTHS = (
    "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    "Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?"
)
DATE_LINE_RE = re.compile(rf"^(.*?)\s+(({MONTHS})\s+\d{{4}}\s+[–-]\s+.+)$", re.IGNORECASE)
PHONE_RE = re.compile(r"\b\d{3}[- ]\d{3}[- ]\d{4}\b")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


@dataclass
class ParsedResume:
    name: str
    header: dict[str, str]
    education: list[dict[str, str]]
    skills: list[dict[str, str]]
    open_source: list[dict[str, Any]]
    projects: list[dict[str, Any]]
    experience: list[dict[str, Any]]
    section_order: list[str]


def api_request(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    url = f"{API_BASE}{path}"
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"API error {exc.code} on {path}: {body}") from exc


def normalize_line(line: str) -> str:
    line = unicodedata.normalize("NFKC", line)
    line = line.replace("\u00a0", " ")
    line = line.replace("/gtb", "")
    line = line.replace(" A WS", " AWS")
    line = re.sub(r"\s+", " ", line).strip()

    # Fix common OCR splits without collapsing legitimate article spacing.
    line = line.replace("W eb", "Web")
    line = line.replace("T ools", "Tools")
    line = line.replace("A gentic", "Agentic")
    line = line.replace("CU-BioF rontiers", "CU-BioFrontiers")
    line = line.replace("BioF rontiers", "BioFrontiers")

    return line


def normalize_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.splitlines():
        line = normalize_line(raw)
        if line:
            lines.append(line)
    return lines


def split_sections(lines: list[str]) -> tuple[list[str], dict[str, list[str]]]:
    section_indices: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        low = line.lower()
        if low == "education":
            section_indices.append((i, "education"))
        elif low == "skills":
            section_indices.append((i, "skills"))
        elif low == "open source contributions":
            section_indices.append((i, "openSource"))
        elif low == "projects":
            section_indices.append((i, "projects"))
        elif low == "experience":
            section_indices.append((i, "experience"))

    if not section_indices:
        raise RuntimeError("Could not detect section headers in PDF text")

    section_indices = sorted(section_indices, key=lambda x: x[0])
    section_map: dict[str, list[str]] = {}
    for idx, (start, key) in enumerate(section_indices):
        end = section_indices[idx + 1][0] if idx + 1 < len(section_indices) else len(lines)
        section_map[key] = lines[start + 1 : end]

    order = [key for _, key in section_indices]
    for key in DEFAULT_SECTION_ORDER:
        if key not in order:
            order.append(key)

    return order, section_map


def parse_header(lines: list[str], first_section_index: int) -> dict[str, str]:
    header_lines = lines[:first_section_index]
    name = header_lines[0] if header_lines else "ARNAV PURUSHOTAM"
    contact = header_lines[1] if len(header_lines) > 1 else ""

    phone_match = PHONE_RE.search(contact)
    email_match = EMAIL_RE.search(contact)

    location = "San Jose, CA, USA"
    parts = re.split(r"\s+[—-]\s+", contact)
    if parts:
        possible_loc = parts[-1].strip()
        if possible_loc and "@" not in possible_loc and re.search(r"[A-Za-z]", possible_loc):
            location = possible_loc

    return {
        "name": name,
        "phone": phone_match.group(0) if phone_match else "720-351-1267",
        "email": email_match.group(0) if email_match else "arnavpsusa@gmail.com",
        "linkedinUrl": "https://www.linkedin.com/in/arnav-purushotam-2375aa203/",
        "linkedinLabel": "LinkedIn",
        "githubUrl": "https://github.com/Arnav-Purushotam-CUBoulder",
        "githubLabel": "GitHub",
        "portfolioUrl": "https://arnav-purushotam-cuboulder.github.io/Portfolio-website/",
        "portfolioLabel": "Portfolio",
        "location": location,
    }


def split_degree_detail(line: str) -> tuple[str, str]:
    if "GPA:" in line:
        left, right = line.split("GPA:", 1)
        return left.strip().rstrip("|"), f"GPA:{right.strip()}"
    return line.strip(), ""


def parse_education(lines: list[str]) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    i = 0
    while i < len(lines):
        line1 = lines[i]
        line2 = lines[i + 1] if i + 1 < len(lines) else ""

        if "|" not in line1:
            i += 1
            continue

        if line1.startswith("University of Colorado, Boulder"):
            institution = "University of Colorado, Boulder"
            right_meta = line1[len(institution) :].strip()
        elif line1.startswith("BMS College of Engineering"):
            institution = "BMS College of Engineering"
            right_meta = line1[len(institution) :].strip()
        else:
            parts = line1.split("|", 1)
            institution = parts[0].strip()
            right_meta = f"| {parts[1].strip()}" if len(parts) > 1 else ""

        degree, detail = split_degree_detail(line2)
        entries.append(
            {
                "institution": institution,
                "rightMeta": right_meta,
                "degree": degree,
                "detail": detail,
            }
        )
        i += 2

    return entries


def normalize_skill_label(label: str) -> str:
    cleaned = label.strip()
    cleaned = cleaned.replace("W eb", "Web")
    cleaned = cleaned.replace("T ools", "Tools")
    cleaned = cleaned.replace("Technologies", "Technologies")
    return cleaned


def parse_skills(lines: list[str]) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for line in lines:
        if ":" not in line:
            continue
        label, value = line.split(":", 1)
        entries.append({"label": normalize_skill_label(label), "value": value.strip()})
    return entries


def parse_bullets(lines: list[str]) -> list[str]:
    bullets: list[str] = []
    current: str | None = None

    for line in lines:
        if line.startswith("•"):
            if current:
                bullets.append(current.strip())
            current = line[1:].strip()
        else:
            if current:
                current += f" {line.strip()}"

    if current:
        bullets.append(current.strip())

    return bullets


def maybe_url(value: str) -> str:
    low = value.lower()
    if "github.com" in low or low.startswith("http"):
        url = value.strip()
        if url.startswith("http://") or url.startswith("https://"):
            return url
        return f"https://{url}"
    return ""


def parse_open_source(lines: list[str]) -> list[dict[str, Any]]:
    if not lines:
        return []

    first = lines[0]
    m = DATE_LINE_RE.match(first)
    title = first
    date_range = ""
    if m:
        title = m.group(1).strip()
        date_range = m.group(2).strip()

    role = ""
    bullet_start = 1
    if len(lines) > 1 and not lines[1].startswith("•"):
        role = lines[1].strip()
        bullet_start = 2

    bullets = parse_bullets(lines[bullet_start:])
    link = "https://github.com/curl/curl" if "curl/libcurl" in title.lower() else maybe_url(title)

    return [
        {
            "title": title,
            "dateRange": date_range,
            "role": role,
            "link": link,
            "points": bullets,
        }
    ]


def parse_projects(lines: list[str]) -> list[dict[str, Any]]:
    projects: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = DATE_LINE_RE.match(line)
        if not m or line.startswith("•"):
            i += 1
            continue

        title = m.group(1).strip()
        date_range = m.group(2).strip()
        i += 1

        link = ""
        if i < len(lines) and ("github.com" in lines[i].lower() or lines[i].lower().startswith("http")):
            link = maybe_url(lines[i])
            i += 1

        bullet_lines: list[str] = []
        while i < len(lines):
            candidate = lines[i]
            if DATE_LINE_RE.match(candidate) and not candidate.startswith("•"):
                break
            bullet_lines.append(candidate)
            i += 1

        bullets = parse_bullets(bullet_lines)
        projects.append(
            {
                "title": title,
                "dateRange": date_range,
                "link": link,
                "points": bullets,
            }
        )

    return projects


def parse_experience(lines: list[str]) -> list[dict[str, Any]]:
    if not lines:
        return []

    line0 = lines[0]
    m = DATE_LINE_RE.match(line0)
    company = line0
    date_range = ""
    if m:
        company = m.group(1).strip()
        date_range = m.group(2).strip()

    role = ""
    bullet_start = 1
    if len(lines) > 1 and not lines[1].startswith("•"):
        role = lines[1].strip()
        bullet_start = 2

    bullets = parse_bullets(lines[bullet_start:])
    return [
        {
            "company": company,
            "dateRange": date_range,
            "role": role,
            "location": "",
            "points": bullets,
        }
    ]


def latex_escape(text: str) -> str:
    text = text.strip()
    text = text.replace("\u2013", "--")
    text = text.replace("\u2014", "--")
    text = text.replace("\u02dc", "~")
    text = text.replace("×", "x")
    text = text.replace("→", "->")
    text = text.replace("“", '"').replace("”", '"').replace("’", "'")

    repl = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    return "".join(repl.get(ch, ch) for ch in text)


def href_latex(url: str, label: str) -> str:
    safe_label = latex_escape(label)
    if not url:
        return safe_label
    return f"\\href{{{url}}}{{{safe_label}}}"


def parse_pdf(pdf_path: Path) -> ParsedResume:
    reader = PdfReader(str(pdf_path))
    text = "\n".join((page.extract_text() or "") for page in reader.pages)
    lines = normalize_lines(text)

    first_section_index = len(lines)
    for i, line in enumerate(lines):
        if line in SECTION_TITLES.values():
            first_section_index = i
            break

    header = parse_header(lines, first_section_index)
    order, section_map = split_sections(lines)

    return ParsedResume(
        name=pdf_path.stem,
        header=header,
        education=parse_education(section_map.get("education", [])),
        skills=parse_skills(section_map.get("skills", [])),
        open_source=parse_open_source(section_map.get("openSource", [])),
        projects=parse_projects(section_map.get("projects", [])),
        experience=parse_experience(section_map.get("experience", [])),
        section_order=order,
    )


def rid(prefix: str, idx: int, item_idx: int) -> str:
    return f"{prefix}_{idx:02d}_{item_idx:02d}"


def build_resume_payload(base_resume: dict[str, Any], parsed: ParsedResume, index: int) -> dict[str, Any]:
    resume = json.loads(json.dumps(base_resume))

    resume["name"] = parsed.name
    resume["headerMode"] = "local"
    resume["localHeader"] = parsed.header
    resume["customLatex"] = None

    section_visibility = {
        "education": len(parsed.education) > 0,
        "skills": len(parsed.skills) > 0,
        "openSource": len(parsed.open_source) > 0,
        "projects": len(parsed.projects) > 0,
        "experience": len(parsed.experience) > 0,
    }

    resume["sectionOrder"] = parsed.section_order
    resume["sectionVisibility"] = section_visibility

    local = {
        "points": {},
        "education": [],
        "skills": [],
        "openSource": [],
        "projects": [],
        "experience": [],
    }

    sections = {
        "education": [],
        "skills": [],
        "openSource": [],
        "projects": [],
        "experience": [],
    }

    for j, edu in enumerate(parsed.education):
        eid = rid("ledu", index, j)
        local["education"].append({
            "id": eid,
            "institution": latex_escape(edu["institution"]),
            "rightMeta": latex_escape(edu["rightMeta"]),
            "degree": latex_escape(edu["degree"]),
            "detail": latex_escape(edu["detail"]),
        })
        sections["education"].append({"localId": eid})

    for j, skill in enumerate(parsed.skills):
        sid = rid("lskill", index, j)
        local["skills"].append({
            "id": sid,
            "label": latex_escape(skill["label"]),
            "value": latex_escape(skill["value"]),
        })
        sections["skills"].append({"localId": sid})

    for j, entry in enumerate(parsed.open_source):
        oid = rid("los", index, j)
        point_ids: list[str] = []
        for k, point in enumerate(entry["points"]):
            pid = rid("lp", index, j * 20 + k)
            local["points"][pid] = {"id": pid, "text": latex_escape(point)}
            point_ids.append(pid)

        link = entry.get("link", "")
        title = href_latex(link, entry.get("title", "Open Source"))
        local["openSource"].append({
            "id": oid,
            "title": title,
            "dateRange": latex_escape(entry.get("dateRange", "")),
            "role": latex_escape(entry.get("role", "")),
            "link": link,
            "pointIds": point_ids,
        })
        sections["openSource"].append({"localId": oid})

    for j, entry in enumerate(parsed.projects):
        pid_entry = rid("lproj", index, j)
        point_ids: list[str] = []
        for k, point in enumerate(entry["points"]):
            pid = rid("lp", index, 100 + j * 20 + k)
            local["points"][pid] = {"id": pid, "text": latex_escape(point)}
            point_ids.append(pid)

        link_url = entry.get("link", "")
        link_latex = href_latex(link_url, link_url) if link_url else ""
        local["projects"].append({
            "id": pid_entry,
            "title": latex_escape(entry.get("title", "Project")),
            "dateRange": latex_escape(entry.get("dateRange", "")),
            "link": link_latex,
            "pointIds": point_ids,
        })
        sections["projects"].append({"localId": pid_entry})

    for j, entry in enumerate(parsed.experience):
        xid = rid("lexp", index, j)
        point_ids: list[str] = []
        for k, point in enumerate(entry["points"]):
            pid = rid("lp", index, 200 + j * 30 + k)
            local["points"][pid] = {"id": pid, "text": latex_escape(point)}
            point_ids.append(pid)

        local["experience"].append({
            "id": xid,
            "company": latex_escape(entry.get("company", "")),
            "dateRange": latex_escape(entry.get("dateRange", "")),
            "role": latex_escape(entry.get("role", "")),
            "location": latex_escape(entry.get("location", "")),
            "pointIds": point_ids,
        })
        sections["experience"].append({"localId": xid})

    resume["local"] = local
    resume["sections"] = sections
    return resume


def ensure_resume(name: str, source_resume_id: str, existing_by_name: dict[str, str]) -> str:
    if name in existing_by_name:
        return existing_by_name[name]

    created = api_request("POST", "/api/resumes", {"name": name, "sourceResumeId": source_resume_id})
    rid_ = created["resume"]["id"]
    existing_by_name[name] = rid_
    return rid_


def import_folder(folder: Path) -> None:
    if not folder.exists() or not folder.is_dir():
        raise RuntimeError(f"Folder not found: {folder}")

    state = api_request("GET", "/api/state")
    resumes = state.get("resumes", [])
    existing_by_name = {r["name"]: r["id"] for r in resumes}

    source_resume_id = "resume_master"
    if source_resume_id not in {r["id"] for r in resumes} and resumes:
        source_resume_id = resumes[0]["id"]

    pdfs = sorted(folder.glob("*.pdf"))
    if not pdfs:
        raise RuntimeError(f"No PDFs found in {folder}")

    for idx, pdf in enumerate(pdfs):
        parsed = parse_pdf(pdf)
        resume_id = ensure_resume(parsed.name, source_resume_id, existing_by_name)

        detail = api_request("GET", f"/api/resumes/{urllib.parse.quote(resume_id)}")
        base_resume = detail["resume"]
        payload = build_resume_payload(base_resume, parsed, idx)

        api_request(
            "PUT",
            f"/api/resumes/{urllib.parse.quote(resume_id)}",
            {
                "resume": payload,
                "message": f"Import content from PDF: {pdf.name}",
            },
        )

        print(f"Imported: {pdf.name} -> {parsed.name} ({resume_id})")


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: import_pdf_resumes.py <pdf_folder>")
        sys.exit(1)

    folder = Path(sys.argv[1]).expanduser()
    import_folder(folder)


if __name__ == "__main__":
    main()
