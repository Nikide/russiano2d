#!/usr/bin/env python3
"""Generate the API docs catalog from authored high-level API documentation."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "api.schema.json"
OUTPUT = ROOT / "src/highlevel/api_docs_catalog.js"
# The editor catalog is a public `$` help/autocomplete surface. Private native
# bridge names such as `engine.raycast` are implementation details and must not
# leak into it even when a doc paragraph explains the bridge.
API_PATH = r"\$\.[\w$]+(?:\.[\w$]+){0,3}"


def clean(value: str) -> str:
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = value.replace("**", "").replace("*", "").replace(r"\|", "|")
    return re.sub(r"\s+", " ", value).strip()


def jsdoc_description(comment: str) -> str:
    comment = re.sub(r"^/\*\*|\*/$", "", comment.strip(), flags=re.S)
    lines = [re.sub(r"^\s*\* ?", "", line).strip() for line in comment.splitlines()]
    paragraph = []
    for line in lines:
        if not line:
            if paragraph:
                break
            continue
        if line.startswith(("@", "```")):
            break
        paragraph.append(line)
    text = clean(" ".join(paragraph))
    # Keep an explanation paragraph, not long internal design notes.
    return text[:600].rstrip()


def render() -> str:
    entries = {item["path"]: item for item in json.loads(SCHEMA.read_text())["names"]}
    by_namespace = {}
    for path, item in entries.items():
        if path.startswith("$.") and item.get("kind") == "object":
            namespace = path[2:]
            by_namespace.setdefault(re.sub(r"[^a-z0-9]", "", namespace.lower()), []).append(namespace)
    catalog = {}
    table_paths = set()
    for source in sorted((ROOT / "docs/highlevel").glob("*.md")):
        lines = source.read_text(errors="replace").splitlines()
        stem_key = re.sub(r"[^a-z0-9]", "", source.stem.lower())
        namespaces = by_namespace.get(stem_key, [])
        if source.stem == "core":
            namespaces = ["selection"]
        if not namespaces:
            # Snake-case documentation names map to camel-case public API names.
            camel = re.sub(r"_([a-z])", lambda match: match.group(1).upper(), source.stem)
            namespaces = by_namespace.get(re.sub(r"[^a-z0-9]", "", camel.lower()), [])
        for line in lines:
            if not line.startswith("|"):
                continue
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if len(cells) < 2:
                continue
            description_cells = [clean(cell) for cell in cells[1:]]
            description = max(
                (cell for cell in description_cells
                 if len(cell) >= 12 and re.search(r"[А-Яа-я]", cell)
                 and cell not in {"Назначение", "Смысл", "Описание"}),
                key=lambda cell: sum(ch.isalpha() for ch in cell),
                default="",
            )
            if len(description) < 12 or description in {"Назначение", "Смысл", "—"}:
                continue
            # Only the first cell identifies the row's subject. API names in
            # the explanation are cross-references, not additional subjects.
            paths = set(re.findall(API_PATH, cells[0]))
            # Tables often use short method names because the file already names
            # the namespace. Resolve those names against the runtime inventory.
            method = re.match(r"(?:`)?([A-Za-z_$][\w$]*)\b", cells[0])
            node_method = re.match(r"(?:`)?\.([A-Za-z_$][\w$]*)\b", cells[0])
            if method:
                for namespace in namespaces:
                    candidate = f"$.{namespace}.{method.group(1)}"
                    if candidate in entries:
                        paths.add(candidate)
            if node_method:
                candidate = f"$.selection.{node_method.group(1)}"
                if candidate in entries:
                    paths.add(candidate)
            for path in sorted(paths):
                entry = entries.get(path)
                if not entry or path in table_paths:
                    continue
                catalog[path] = {"description": description}
                table_paths.add(path)

        # Function-specific sections commonly use `### method(args)` and put
        # the explanation in the paragraph immediately below the heading.
        if namespaces:
            for index, line in enumerate(lines):
                if not re.match(r"^#{2,4}\s+", line):
                    continue
                heading = re.sub(r"^#{2,4}\s+", "", line).strip()
                method = re.search(r"(?:`)?([A-Za-z_$][\w$]*)\s*\(", heading)
                if not method:
                    continue
                paragraph = []
                for following in lines[index + 1:]:
                    if following.lstrip().startswith("|") or following.startswith("#") or following.startswith("```"):
                        break
                    if not following.strip():
                        if paragraph or following.startswith("#"):
                            break
                        continue
                    paragraph.append(following.strip())
                description = clean(" ".join(paragraph))
                if len(description) < 16 or not re.search(r"[А-Яа-я]", description):
                    continue
                explicit_path = re.search(r"\$\.[\w$]+(?:\.[\w$]+){0,3}", heading)
                if explicit_path:
                    path = explicit_path.group(0)
                    if entries.get(path, {}).get("kind") == "function":
                        catalog.setdefault(path, {"description": description[:600]})
                for namespace in namespaces:
                    path = f"$.{namespace}.{method.group(1)}"
                    if entries.get(path, {}).get("kind") == "function":
                        catalog.setdefault(path, {"description": description[:600]})
                if re.search(r"(?:`)?\.[A-Za-z_$][\w$]*\s*\(", heading):
                    path = f"$.selection.{method.group(1)}"
                    if entries.get(path, {}).get("kind") == "function":
                        catalog.setdefault(path, {"description": description[:600]})

        # Descriptive prose often mentions several methods in the same
        # paragraph instead of giving each one a table row or heading.
        paragraphs = []
        current = []
        in_code = False
        for line in lines:
            if line.startswith("```"):
                in_code = not in_code
                if current:
                    paragraphs.append(" ".join(current))
                    current = []
                continue
            if in_code or not line.strip() or line.startswith("#") or line.startswith("|"):
                if current:
                    paragraphs.append(" ".join(current))
                    current = []
                continue
            current.append(line.strip())
        if current:
            paragraphs.append(" ".join(current))
        for paragraph in paragraphs:
            paths = set(re.findall(API_PATH, paragraph))
            description = clean(paragraph)
            # A paragraph mentioning multiple APIs is explanatory context;
            # assigning it to every mentioned symbol produces false docs.
            if len(paths) != 1 or len(description) < 20 or len(description) > 600 or not re.search(r"[А-Яа-я]", description):
                continue
            for path in sorted(paths):
                if path not in table_paths and entries.get(path, {}).get("kind") == "function":
                    catalog.setdefault(path, {"description": description})

        # The first paragraph after the title describes the module namespace.
        match = re.search(r"^#\s+[^\n]+\n+((?:(?!^#{1,2}\s).+\n?){1,8})", "\n".join(lines), re.M)
        if match:
            intro = clean(re.split(r"\n\s*\n|```", match.group(1))[0])
            namespace = "$." + source.stem
            if intro and len(intro) <= 420 and entries.get(namespace, {}).get("kind") == "object":
                catalog.setdefault(namespace, {"description": intro})

    # Public API implementations often already carry precise Russian JSDoc.
    # Attach it only when the exported function name resolves to an actual
    # runtime API path; private helpers therefore never leak into the catalog.
    for source in sorted((ROOT / "src/highlevel").glob("*.js")):
        stem = source.stem
        if stem == "core":
            namespaces = ["selection"]
        else:
            key = re.sub(r"[^a-z0-9]", "", stem.lower())
            namespaces = by_namespace.get(key, [])
            if not namespaces:
                camel = re.sub(r"_([a-z])", lambda match: match.group(1).upper(), stem)
                namespaces = by_namespace.get(re.sub(r"[^a-z0-9]", "", camel.lower()), [])
        text = source.read_text(errors="replace")
        patterns = [
            re.compile(r"(/\*\*[\s\S]*?\*/)\s*(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\("),
            re.compile(r"(/\*\*[\s\S]*?\*/)\s*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{"),
            re.compile(r"(/\*\*[\s\S]*?\*/)\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function\s*\("),
            re.compile(r"(/\*\*[\s\S]*?\*/)\s*def(?:Get)?\(\s*['\"]([A-Za-z_$][\w$]*)['\"]\s*,"),
        ]
        matches = {}
        for pattern in patterns:
            for match in pattern.finditer(text):
                matches.setdefault(match.start(), match)
        for match in matches.values():
            description = jsdoc_description(match.group(1))
            name = match.group(2)
            if len(description) < 16 or not re.search(r"[А-Яа-я]", description):
                continue
            public_names = {name}
            suffix = re.sub(r"[^A-Za-z0-9]", "", stem)
            suffix = suffix[:1].upper() + suffix[1:]
            if suffix and name.endswith(suffix) and len(name) > len(suffix):
                public_names.add(name[:-len(suffix)])
            candidates = [f"$.{namespace}.{public_name}" for namespace in namespaces for public_name in public_names]
            if re.search(r"\bdef(?:Get)?\(", match.group(0)):
                candidates.append(f"$.selection.{name}")
                candidates.append(f"$.fn.{name}")
            if stem == "api":
                candidates.append(f"$.{name}")
            for path in candidates:
                entry = entries.get(path)
                if entry and entry.get("kind") == "function":
                    catalog.setdefault(path, {"description": description})

    # Manually reviewed semantics derived from the method implementations.
    authored = json.loads((ROOT / "docs/highlevel/api_symbol_descriptions.json").read_text())
    for path, description in authored.items():
        if path in entries and isinstance(description, str) and description.strip():
            catalog[path] = {"description": description.strip()}

    # The localized namespaces and `$.fn` are aliases of the same operations;
    # carry the canonical description across where a matching runtime symbol
    # exists so editor help does not disappear on an equivalent spelling.
    ru_source = (ROOT / "src/highlevel/ru.js").read_text(errors="replace")
    def read_alias_table(table_name: str) -> dict[str, str]:
        match = re.search(rf"export const {table_name} = \{{([\s\S]*?)\n\}};", ru_source)
        if not match:
            return {}
        return dict(re.findall(r"['\"]([^'\"]+)['\"]\s*:\s*['\"]([^'\"]+)['\"]", match.group(1)))

    aliases = read_alias_table("RU_NAMESPACES")
    for alias, canonical in aliases.items():
        prefix = f"$.{alias}"
        for path, metadata in list(catalog.items()):
            if path == f"$.{canonical}" or path.startswith(f"$.{canonical}."):
                alias_path = prefix + path[len(f"$.{canonical}"):]
                if alias_path in entries:
                    catalog.setdefault(alias_path, metadata)

    # Selection and node wrappers expose the same fluent methods. The runtime
    # schema distinguishes the receiver (`$.selection` / `$.fn`), while their
    # operation and semantics are identical.
    for path, metadata in list(catalog.items()):
        if path.startswith("$.selection."):
            node_path = "$.fn." + path[len("$.selection."):]
            if node_path in entries:
                catalog.setdefault(node_path, metadata)
        elif path.startswith("$.fn."):
            selection_path = "$.selection." + path[len("$.fn."):]
            if selection_path in entries:
                catalog.setdefault(selection_path, metadata)

    for alias, canonical in read_alias_table("RU_METHODS").items():
        for root in ("$.selection", "$.fn"):
            source_path = f"{root}.{canonical}"
            alias_path = f"{root}.{alias}"
            if source_path in catalog and alias_path in entries:
                catalog.setdefault(alias_path, catalog[source_path])
    for path, metadata in list(catalog.items()):
        if path.startswith("$.selection."):
            fn_path = "$.fn." + path[len("$.selection."):]
            if fn_path in entries:
                catalog.setdefault(fn_path, metadata)

    # Keep callable signatures and symbol kinds beside their descriptions so
    # the editor can autocomplete from the embedded catalog without reading a
    # project-local schema file.
    for path, metadata in list(catalog.items()):
        runtime = entries.get(path, {})
        signature = {key: runtime[key] for key in ("kind", "arity", "args", "returns") if key in runtime}
        catalog[path] = {**signature, **metadata}

    return (
        "// Generated from authored docs, API JSDoc, and api_symbol_descriptions.json.\n"
        "// Run `python3 scripts/generate_api_docs_catalog.py` after editing source docs.\n"
        "export const API_DOCS_CATALOG = "
        + json.dumps(catalog, ensure_ascii=False, indent=4)
        + ";\n"
    )
def main() -> int:
    check = "--check" in sys.argv[1:]
    unknown = [arg for arg in sys.argv[1:] if arg != "--check"]
    if unknown:
        print(f"unknown argument: {unknown[0]}", file=sys.stderr)
        return 2
    expected = render()
    if check:
        try:
            current = OUTPUT.read_text()
        except OSError:
            current = None
        if current != expected:
            print(f"STALE {OUTPUT.relative_to(ROOT)} — run python3 scripts/generate_api_docs_catalog.py")
            return 1
        print(f"fresh {OUTPUT.relative_to(ROOT)}")
        return 0
    OUTPUT.write_text(expected)
    print(f"wrote {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
