#!/bin/sh
# Rewrites the MY_APP_* placeholders that the front build leaves in the bundle.
# The built JS always contains the literal placeholders, so a missing container variable
# used to degrade silently: the app then called <origin>/MY_APP_VITE_API_URL/... and nginx
# answered with the SPA HTML and a 200. Report every variable so the container log shows
# whether the backend URL was actually injected.
injected=0
for i in $(env | grep MY_APP_)
do
    key=$(echo $i | cut -d '=' -f 1)
    value=$(echo $i | cut -d '=' -f 2-)
    find /usr/share/nginx/html -type f -exec sed -i "s|${key}|${value}|g" '{}' +
    echo "env.sh: injected ${key}"
    injected=$((injected + 1))
done

if [ "$injected" -eq 0 ]; then
    echo "env.sh: WARNING no MY_APP_* variable set; if the backend URL is not baked in via the VITE_API_URL build arg, the front will not reach the API"
fi
