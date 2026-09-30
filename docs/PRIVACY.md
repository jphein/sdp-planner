# Privacy

**Short version:** sdp-planner does all its work inside your web browser. Your spending plan, your FMS report and your what-if numbers never leave your device. There is no account, no server and no tracking.

## What happens to your files

- **Nothing is uploaded.** When you drop in your spending plan or FMS report, your browser reads the file itself. A bundled copy of SheetJS (`vendor/xlsx.full.min.js`) turns the spreadsheet into numbers right there on the page. The file is never sent to any server, including ours: there isn't one.
- **The math runs locally.** The forecast, pace and proposal calculations are ordinary JavaScript running in your browser tab.
- **No PHI or personal information leaves the device.** That covers the participant's name, UCI number, providers' names, dollar amounts and anything else in your files or typed into the page. None of it is sent anywhere.

## What is saved, and where

- The page saves your work in your browser's **`localStorage`**: the imported plan and report, your proposal, your named scenarios and your edited budgets. That is why it is still there when you come back.
- `localStorage` lives only in **this browser, on this device**. It is not synced to other devices by us, and nobody else can read it over the internet.
- **Clear my data** erases everything the page saved in one click. Clearing your browser's site data for this page, or using a private/incognito window, does the same.
- **Export** downloads your proposal as a JSON file to your own computer, and **Import** reads such a file back. The file is yours; the tool keeps no copy.

On a shared or public computer, press **Clear my data** when you are done, or use a private window.

## No analytics, no cookies, no tracking

There are no analytics, no tracking pixels, no advertising, no cookies and no error-reporting services. The page does not count or identify its visitors.

## The one third-party request: fonts

The page loads its three typefaces (Fraunces, Instrument Sans and IBM Plex Mono) from **Google Fonts** (`fonts.googleapis.com` and `fonts.gstatic.com`). That request is made by your browser when the page opens, and it works like visiting any website. Google can see your IP address, your browser type and which page asked for the fonts. **None of your plan data is included**: the request happens before you load a file and contains only the font names.

If you'd rather avoid it, any of these works:

- **Block it.** A content blocker (for example uBlock Origin) set to block `fonts.googleapis.com`, or your browser's "block third-party requests" setting. The page falls back to your system fonts and works the same.
- **Go offline.** Open the page, then disconnect from the internet before loading your files. Or save the page and open your local copy while offline. Everything except the fancy fonts still works.
- **Run your own copy.** Download the repository and open `index.html` from your disk (`file://`). With no network, it uses system fonts.

## When the page is hosted on GitHub Pages

If you use the hosted copy, GitHub serves the page files (HTML, JavaScript, CSS) and, like any web host, sees an ordinary request for them. It never sees your plan or report, because those are opened locally after the page has loaded. The deployed copy includes a small `version.json` build stamp ([realm-sigil](https://github.com/jphein/sigil.realm.watch)), which describes the code, not you.

## Checking these claims yourself

You don't have to take our word for it. Open your browser's developer tools (F12), go to the **Network** tab and load your files. You will see no requests leave the page apart from the fonts described above. The source is short, readable and in this repository.

## Contributors: keep it this way

Any change that adds a network request, a third-party script, analytics, or storage beyond `localStorage` must update this file in the same pull request and explain why. See [`CONTRIBUTING.md`](../CONTRIBUTING.md).
