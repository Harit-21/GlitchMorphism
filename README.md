# GlitchMorphism
## Sculpting glitches in omnimatrix 

**GlitchMorphism** is a modular game exploit framework designed to shape, evolve, and control glitches across multiple environments. Not just hacks — transformations.

## ✨ Features

- 🔧 Modular glitch injection
- ⏱ Frame & timing manipulation
- 🧠 AI-assisted exploit discovery
- 🎮 Multi-game support (profiles & targets)

## 🧪 Philosophy

Glitches are not errors — they're raw potential. **GlitchMorphism** is the art of crafting control from chaos.

---

## 🚀 Get Started
...

Concept - Should we implement?

Excellent question! Your Speed Timer app has a fantastic foundation. Now that the core is stable and reliable, you can build some really cool features on top of it.

Here are a few ideas, ranging from simple additions to more advanced features, to take your project to the next level.

---
### ### Tier 1: Easy & High-Impact Features

These are great next steps that add a lot of value without being too complex.

#### **1. A "History" View for Completed Timers**
Since you decided to keep completed timers in the database, you can now display them!

* **What it is:** A separate section or a toggle button on the page that shows a list of all timers that have `notified = True`. You could show the name and when it was completed.
* **Why it's great:** It turns your app from just a timer into a logbook of your completed tasks, which is very motivating.
* **How to do it:**
    * Create a new API endpoint in `server.py` like `@app.get("/timers/history")` that queries the database for timers where `notified IS TRUE`.
    * Add a button and a new container in `index.html` and fetch/display the data in `app.js`.

#### **2. Sound and Browser Notifications**
Get an alert directly from your browser, even if you don't have Telegram open.

* **What it is:** When a timer finishes, the web page can play a sound and/or pop up a native desktop/mobile notification.
* **Why it's great:** It provides immediate feedback and is a standard feature for timer apps.
* **How to do it:** This is purely a frontend change in `app.js`. You can use the browser's built-in `Notification` API and the `<audio>` element.

---
### ### Tier 2: Intermediate Features

These require a bit more work on both the backend and frontend but add significant power.

#### **3. Edit Timers**
Right now you can only add and delete. What if you make a mistake?

* **What it is:** An "edit" button on each timer card that opens a small form (a modal) allowing you to change the timer's name or duration.
* **Why it's great:** A fundamental quality-of-life improvement that users will expect.
* **How to do it:**
    * Create a new API endpoint like `@app.put("/timers/{timer_id}")` in `server.py` to handle the update.
    * Add an edit icon and the modal popup logic in your frontend files.

#### **4. Recurring Timers**
For tasks that you do every day or every week.

* **What it is:** When creating a timer, you could add an option for it to repeat (e.g., "repeat daily"). When the timer finishes, the backend automatically creates a new one for the next cycle.
* **Why it's great:** Turns the app into a powerful tool for building habits and tracking routine tasks.
* **How to do it:**
    * Add a `repeat_interval` column to your `timers` table in the database.
    * Update the `background_checker` in `server.py` to re-create the timer instead of deleting it if `repeat_interval` is set.

---
### ### Tier 3: The 'Next Level' Feature

This is a bigger change that would turn your project into a full-fledged, multi-user application.

#### **5. User Accounts & Multi-Device Sync**
Let users sign up and see their timers on any device.

* **What it is:** Add a sign-up/login system. Timers would be tied to a user's account. A user could log in on their laptop and their phone and see the exact same set of timers.
* **Why it's great:** This is the ultimate feature. It makes the app personal, secure, and accessible from anywhere.
* **How to do it:**
    * This is the perfect use case for **Supabase's built-in Auth**. It handles all the difficult parts of user management (sign-up, login, password resets) for you.
    * You would add a `user_id` column to your `timers` table.
    * All your API endpoints in `server.py` would be updated to only fetch or modify timers belonging to the currently logged-in user.

### ## My Recommendation

I would suggest starting with **#1 (History View)** and **#2 (Sound/Browser Notifications)**. They are relatively easy to implement, add a lot of polish, and are a natural extension of the work you've already done.

Whichever you choose, feel free to ask, and I can help you with the code for it. Great work on the project so far!


==========

Summary of Enhancements
🎨 Custom-Styled Checkboxes: The default browser checkboxes have been replaced with custom ones that perfectly match the app's dark, amber-accented theme.

👆 Clickable Timer Cards: You can now click anywhere on a timer card to select or deselect it, which is much more convenient than aiming for a tiny checkbox.

➕ "Select All" Button: A new "Select All" button has been added to the bulk actions panel, allowing you to quickly select all active timers.

🧠 Smarter Focus: When the bulk actions panel appears, the "minutes" input field is now automatically focused, saving you a click.

⏳ Loading Indicator: The "Reduce Time" button now shows a spinner and is disabled while the request is being processed, providing better feedback.
