#!/usr/bin/env bash
# Extract Arcade session cookie.
# Usage: ./scripts/get-arcade-cookie.sh [--from-devtools]
#
# Default: Opens app.arcade.software in a fresh Playwright-managed browser.
#          If you're logged in via SSO in that browser, cookies are extracted.
#
# --from-devtools: Prints instructions to manually copy the cookie from
#                  Chrome DevTools (use when you have Chrome open with
#                  multiple profiles).
#
# Outputs: ~/.arcade-cookie

set -euo pipefail

COOKIE_FILE="${ARCADE_COOKIE_FILE:-$HOME/.arcade-cookie}"

if [[ "${1:-}" == "--from-devtools" ]]; then
  cat >&2 << 'EOF'
To extract the Arcade cookie from Chrome DevTools:

  1. Open https://app.arcade.software in Chrome (make sure you're logged in)
  2. Open DevTools (F12) → Network tab
  3. Refresh the page (Ctrl+R)
  4. Click the first request to "app.arcade.software" (the HTML document)
  5. In the Headers pane, find "cookie:" under Request Headers
  6. Right-click the value → Copy value
  7. Run:

EOF
  echo "     echo '<paste>' > $COOKIE_FILE && chmod 600 $COOKIE_FILE" >&2
  echo "" >&2
  echo "  Then verify with:" >&2
  echo "     node --import tsx src/index.ts publish-ext --dry-run <artifact-dir>" >&2
  exit 0
fi

echo "Launching browser to extract Arcade cookies..." >&2
echo "(If not logged in, you may need to log in via SSO first)" >&2

# Use Playwright to launch a fresh browser, navigate to Arcade, extract cookies
npx -y playwright@latest test --reporter=line 2>/dev/null << 'EOF' || true
EOF

# Actually, use node + playwright directly
node -e "
const pw = require('playwright');

(async () => {
  const browser = await pw.chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.error('Opening app.arcade.software...');
  await page.goto('https://app.arcade.software', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for login if needed (SSO redirect)
  console.error('Waiting for login (30s timeout)...');
  try {
    await page.waitForURL('**/workspaces/**', { timeout: 30000 });
  } catch {
    console.error('Did not reach workspace. If SSO login is required, use --from-devtools instead.');
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(2000);

  // Extract cookies
  const cookies = await context.cookies('https://app.arcade.software');
  const arcadeCookies = cookies.filter(c => c.domain.includes('arcade.software'));

  const names = new Set(arcadeCookies.map(c => c.name));
  if (!names.has('ArcadeApp.AuthUser') || !names.has('ArcadeApp.AuthUserTokens')) {
    console.error('Auth cookies not found. Make sure you completed the SSO login.');
    await browser.close();
    process.exit(1);
  }

  const cookieStr = arcadeCookies.map(c => c.name + '=' + c.value).join('; ');

  const fs = require('fs');
  fs.writeFileSync('$COOKIE_FILE', cookieStr);
  fs.chmodSync('$COOKIE_FILE', 0o600);
  console.error('Cookie saved to $COOKIE_FILE (' + arcadeCookies.length + ' cookies)');

  // Check token expiry
  try {
    const tc = arcadeCookies.find(c => c.name === 'ArcadeApp.AuthUserTokens');
    const decoded = JSON.parse(JSON.parse(Buffer.from(tc.value, 'base64').toString()));
    const parts = decoded.idToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const exp = new Date(payload.exp * 1000);
    const mins = Math.round((exp - Date.now()) / 60000);
    console.error('Token valid for ' + mins + ' minutes');
  } catch {}

  await browser.close();
  console.error('Done.');
})().catch(e => {
  console.error('Error: ' + e.message);
  process.exit(1);
});
" 2>&1

