#!/usr/bin/env bash
set -eo pipefail  # removed 'u' to allow unset $1

if [ -n "${1:-}" ]; then
  changelog_date="$1"
else
  changelog_date="$(date +%Y-%m-%d)"
fi

tmpfile=$(mktemp)
today="## Issues referenced in develop  (${changelog_date})"

TODAY_ISSUES=$(git log develop --since="${changelog_date}T00:00:00" --until="${changelog_date}T23:59:59" --pretty=format:"%B" | grep -oE '#[0-9]+' | tr -d '#' | sort -u || true)

echo "$today" >> "$tmpfile"
echo "" >> "$tmpfile"

repo="YellowsysOrg/Yellowstorm-vectorstore"
owner="YellowsysOrg"
reponame="Yellowstorm-vectorstore"

# Fetch User Stories by type using GraphQL instead of label
user_stories=$(gh api graphql -f query='
{
  repository(owner: "'"$owner"'", name: "'"$reponame"'") {
    issues(first: 100, states: OPEN) {
      nodes {
        number
        title
        issueType {
          name
        }
      }
    }
  }
}' --jq '.data.repository.issues.nodes[] | select(.issueType.name == "User Story") | [.number, .title] | @tsv')

declare -A grouped_tasks
declare -A story_titles
declare -A parented_issues
unparented_block=""

# Group tasks by parent user story
while IFS=$'\t' read -r story_num story_title; do
  [[ -z "$story_num" ]] && continue
  [[ "$story_num" =~ ^[0-9]+$ ]] || continue

  story_titles["$story_num"]="$story_title"
  sub_issues=$(gh api repos/$repo/issues/$story_num/sub_issues --jq '.[].number' 2>/dev/null)
  for sub_num in $sub_issues; do
    if echo "$TODAY_ISSUES" | grep -q "^$sub_num$"; then
      issue_type=$(gh api graphql -f query='
      {
        repository(owner: "'"$owner"'", name: "'"$reponame"'") {
          issue(number: '"$sub_num"') {
            issueType {
              name
            }
          }
        }
      }' --jq '.data.repository.issue.issueType.name // ""')
      if echo "$issue_type" | grep -Eiq 'task|user story'; then
        issue_line=$(gh issue view "$sub_num" --repo "$repo" --json number,title --template "- [#{{.number}}](https://github.com/$repo/issues/{{.number}}): {{.title}}")
        grouped_tasks["$story_num"]+="${issue_line}\n"
        parented_issues["$sub_num"]=1
      fi
    fi
  done
done <<< "$user_stories"

# Find unparented issues
for issue in $TODAY_ISSUES; do
  issue_type=$(gh api graphql -f query='
  {
    repository(owner: "'"$owner"'", name: "'"$reponame"'") {
      issue(number: '"$issue"') {
        issueType {
          name
        }
      }
    }
  }' --jq '.data.repository.issue.issueType.name // ""')
  if echo "$issue_type" | grep -Eiq 'task|user story'; then
    if [ -z "${parented_issues[$issue]}" ]; then
      issue_line=$(gh issue view "$issue" --repo "$repo" --json number,title --template "- [#{{.number}}](https://github.com/$repo/issues/{{.number}}): {{.title}}")
      unparented_block="${unparented_block}${issue_line}\n"
    fi
  fi
done

# Print grouped tasks under their parent user story
for story_num in "${!grouped_tasks[@]}"; do
  echo "### [User Story: #$story_num - ${story_titles[$story_num]}](https://github.com/$repo/issues/$story_num)" >> "$tmpfile"
  echo -e "${grouped_tasks[$story_num]}" >> "$tmpfile"
  echo "" >> "$tmpfile"
done

# Print unparented issues if any
if [ -n "$unparented_block" ]; then
  echo "### Unparented" >> "$tmpfile"
  echo -e "$unparented_block" >> "$tmpfile"
  echo "" >> "$tmpfile"
fi

echo "" >> "$tmpfile"

awk -v today="$today" '
  BEGIN { skip=0 }
  NR == 1 && tolower($0) ~ /^# changelog/ { next }
  $0 == today { skip=1; next }
  skip && /^## / { skip=0 }
  !skip
' CHANGELOG.md >> "$tmpfile"

sed -i '1i# Changelog\n' "$tmpfile"
mv "$tmpfile" CHANGELOG.md