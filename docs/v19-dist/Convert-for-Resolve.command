#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
converter_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ "$#" -eq 0 ]; then
  chosen_file=$(osascript -e 'POSIX path of (choose file with prompt "Choose a Growth recording to convert to ProRes for Resolve")') || exit 1
  set -- "$chosen_file"
fi
python3 "$converter_dir/convert-for-resolve.py" "$@"
conversion_status=$?
read -r -p "Press Return to close. " ignored_key
exit "$conversion_status"
