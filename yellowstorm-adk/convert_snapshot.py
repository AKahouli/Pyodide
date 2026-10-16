#!/usr/bin/env python3
"""
Script to convert Python-like snapshot syntax to proper JSON format.
Converts files with Python syntax (True/False, None, single quotes) to valid JSON.
"""

import re
import json
import sys
from pathlib import Path


def convert_python_to_json(text):
    """
    Convert Python-like syntax to JSON-compatible syntax.

    Replacements:
    - True → true
    - False → false
    - None → null
    - Single quotes ' → Double quotes "
    """
    result = text

    # Order matters! Do these replacements in this order:

    # 1. Replace True (but not inside strings) - word boundary to avoid partial matches
    result = re.sub(r'\bTrue\b', 'true', result)

    # 2. Replace False
    result = re.sub(r'\bFalse\b', 'false', result)

    # 3. Replace None
    result = re.sub(r'\bNone\b', 'null', result)

    # 4. Replace single quotes with double quotes for JSON strings
    result = result.replace("'", '"')

    return result


def extract_json_from_file(file_path):
    """
    Read file and extract/convert the JSON content.
    Handles files that might have extra content before/after the JSON.
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Try to find JSON-like structure (starts with { or [)
    json_start = -1
    for i, char in enumerate(content):
        if char in '{[':
            json_start = i
            break

    if json_start == -1:
        raise ValueError("No JSON structure found in file")

    # Extract from the first { or [ to the end
    json_content = content[json_start:]

    # If there's trailing content after the JSON, try to find the end
    # Count brackets to find matching closing
    bracket_count = 0
    in_string = False
    escape_next = False
    json_end = -1

    for i, char in enumerate(json_content):
        if escape_next:
            escape_next = False
            continue

        if char == '\\':
            escape_next = True
            continue

        if char == '"' and not escape_next:
            in_string = not in_string
            continue

        if not in_string:
            if char in '{[':
                bracket_count += 1
            elif char in '}]':
                bracket_count -= 1
                if bracket_count == 0:
                    json_end = i + 1
                    break

    if json_end > 0:
        json_content = json_content[:json_end]

    return json_content


def convert_snapshot_file(input_file, output_file=None):
    """
    Convert a malformed snapshot file to proper JSON.
    """
    input_path = Path(input_file)

    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_file}")

    # Read and extract content
    print(f"Reading file: {input_file}")
    raw_content = extract_json_from_file(input_file)

    # If content starts with a property like "snapshot":{...}, wrap it in {}
    raw_content = raw_content.strip()
    if raw_content.startswith('"') and ':' in raw_content and not raw_content.startswith('{'):
        raw_content = '{' + raw_content + '}'

    # Convert Python syntax to JSON
    print("Converting Python syntax to JSON...")
    converted = convert_python_to_json(raw_content)

    # Validate by parsing as JSON
    try:
        parsed = json.loads(converted)
        print("[OK] JSON is valid!")
    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON parsing error: {e}")
        print("First 500 characters of converted content:")
        print(converted[:500])
        raise

    # Determine output file
    if output_file is None:
        output_file = input_path.with_suffix('.json')
    else:
        output_file = Path(output_file)

    # Write the pretty-printed JSON
    print(f"Writing to: {output_file}")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(parsed, f, indent=3, ensure_ascii=False)

    print(f"✓ Successfully converted and saved to: {output_file}")
    return output_file


def main():
    """Command line interface."""
    if len(sys.argv) < 2:
        print("Usage: python convert_snapshot.py <input_file> [output_file]")
        print("\nExamples:")
        print("  python convert_snapshot.py snapshot3.js")
        print("  python convert_snapshot.py snapshot3.js output.json")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        convert_snapshot_file(input_file, output_file)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()