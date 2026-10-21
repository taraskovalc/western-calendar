# Slotted for DraftMySchedule (browser extension)

An optional shortcut for [Slotted](https://slotted.taraskoval.ca/). On your DraftMySchedule
class list it adds a **Send to Slotted** button. Click it and Slotted opens in a new tab with
your schedule already read in, so there's no page to save and no file to upload.

Slotted works the same without it.

## Try it (Chrome, Edge, Brave)

1. Go to `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this `extension` folder.
3. Open DraftMySchedule, go to **My Current Schedule**, and click **Send to Slotted**
   (or the Slotted icon in the toolbar, which opens My Current Schedule from anywhere).

## What it can see and do

- It only runs on DraftMySchedule's **My Current Schedule** page and on Slotted itself.
- When you click the button, it copies that one page and hands it to the Slotted tab it
  opens. The page stays in your browser: it's held for a moment in the extension's
  short-term storage, deleted as soon as Slotted takes it, and never sent to a server.
- The only permission it asks for is `storage` (for that hand-off).

## Credit

Thanks to eq's [ClassMySchedule](https://github.com/jshklz/classmyschedule) (public domain),
which showed that an extension can read the schedule straight from the open page.
