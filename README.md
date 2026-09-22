# ♠ Blackjack Friends — Chromebook setup guide

This is a private **play-money** multiplayer blackjack site for you and your friends.

It is designed so you can set it up from a Chromebook without installing programming software.

## What you get

- Private email/password accounts
- Approved-friend access
- Private lobbies and invite codes
- Up to 7 seats
- A player can be the dealer/host
- Realtime blackjack
- Hit / Stand / Double
- Virtual chips
- Dealer-controlled **money ledger**
  - **Give money** to a player → their balance with the dealer goes up
  - **Take money** from a player → their balance with the dealer goes down
  - `+500` means **the dealer owes that player 500**
  - `-500` means **that player owes the dealer 500**
  - `0` means settled
- Mobile/Chromebook-friendly interface
- GitHub Pages hosting
- Supabase authentication/database/realtime

### Important

The dealer ledger is only a record of play-money balances. This project does **not** take payments, cash, deposits, withdrawals, or real-money bets.

---

# PART 1 — Make the project on GitHub

You do NOT need VS Code, Linux, a terminal, or programming experience.

### Step 1 — Create a GitHub account

Go to:

https://github.com/

Log in or create an account.

### Step 2 — Create a repository

1. Click the **+** button in the top-right.
2. Click **New repository**.
3. Repository name:

`blackjack-friends`

4. Choose **Public** for the easiest GitHub Pages setup.
5. Tick **Add a README file** if GitHub offers the option.
6. Click **Create repository**.

### Step 3 — Upload the website files

Download the ZIP from ChatGPT and open it on your Chromebook.

In the Chromebook Files app:
1. Find `blackjack-friends-github.zip`.
2. Double-click it.
3. Copy/extract the folder somewhere easy, such as Downloads.

Your folder contains:

- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `README.md`
- `supabase/schema.sql`

In GitHub:

1. Open your new repository.
2. Click **Add file → Upload files**.
3. Upload these five files from the main folder:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `config.js`
   - `README.md`
4. Click **Commit changes**.

Then create the Supabase SQL file:

1. Click **Add file → Create new file**.
2. In the filename box type:

`supabase/schema.sql`

3. Open the extracted `supabase/schema.sql` on your Chromebook.
4. Copy everything inside it.
5. Paste it into GitHub's editor.
6. Click **Commit changes**.

You should now see:

```text
blackjack-friends
├── index.html
├── styles.css
├── app.js
├── config.js
├── README.md
└── supabase
    └── schema.sql
```

---

# PART 2 — Create the free Supabase backend

GitHub Pages can host the website, but it cannot store logins, lobbies and realtime game data by itself.

Supabase handles that part.

### Step 1

Go to:

https://supabase.com/

Create an account and create a new project.

The free plan is enough to get started with this friends-only project.

### Step 2 — Run the database setup

In your Supabase project:

1. Find **SQL Editor** in the left menu.
2. Click **New query**.
3. Open your GitHub `supabase/schema.sql`.
4. Copy the entire file.
5. Paste it into the Supabase SQL Editor.
6. Click **Run**.

You should see a successful result.

If you get an error, **don't randomly change the SQL**. Send me the exact error message and I can tell you what to change.

---

# PART 3 — Add your friends

This is what keeps random people from using the site.

In Supabase:

1. Open **Table Editor**.
2. Find `approved_users`.
3. Add a row for every friend.
4. Put their email address in the `email` column.

Example:

```text
alice@gmail.com
bob@gmail.com
charlie@gmail.com
```

Only people whose email is approved should be able to create/use an account.

For an even tighter private setup, use Supabase Authentication settings to disable open sign-ups and invite/create your friends' accounts yourself.

---

# PART 4 — Connect the website to Supabase

You need two pieces of information from Supabase.

Open:

**Project Settings → API**

Find:

- Project URL
- Publishable/anon key

DO NOT use the `service_role` key.

### Edit `config.js`

In GitHub:

1. Open `config.js`.
2. Click the pencil/edit button.
3. Replace:

```js
SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY"
```

with your actual values.

For example:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://abcxyz.supabase.co",
  SUPABASE_ANON_KEY: "your-public-key-here"
};
```

4. Click **Commit changes**.

### Security warning

The public/anon key belongs in a browser website.

**Never put your Supabase `service_role` secret key in `config.js`.**

---

# PART 5 — Turn on email login

In Supabase:

1. Go to **Authentication**.
2. Open **Providers**.
3. Make sure **Email** is enabled.

Depending on your Supabase settings, users may need to confirm their email.

That is normal.

---

# PART 6 — Put the website online

In GitHub:

1. Open your repository.
2. Click **Settings**.
3. Click **Pages**.
4. Under deployment/source, choose:
   - **Deploy from a branch**
   - Branch: `main`
   - Folder: `/ (root)`
5. Save.

Wait a minute or two.

GitHub will give you an address similar to:

`https://YOUR-USERNAME.github.io/blackjack-friends/`

That's your website.

---

# PART 7 — Tell Supabase where the website lives

In Supabase:

1. Go to **Authentication**.
2. Open **URL Configuration**.
3. Put your GitHub Pages address into the Site URL.
4. Add the same address as an allowed redirect URL if Supabase asks for one.
5. Save.

---

# PART 8 — First test

Open your GitHub Pages website.

Try this with your own account first.

### Create account

Use an email that you already added to `approved_users`.

If account creation works, log in.

### Create a table

Click:

**+ New table**

Give it a name such as:

`Friday Night Blackjack`

Create the table.

You should see an invite code.

### Test another player

Send the website address and invite code to a friend.

They create/log into their account and join the table.

---

# How the dealer money system works

The dealer is the host of the table.

On the right side, the dealer sees a **Dealer Bank** panel.

Choose a player and enter an amount.

### Give money

If you press:

**Give money → 500**

that player becomes:

`+500`

This means:

**Dealer owes player 500**

### Take money

If you press:

**Take money → 500**

their balance changes by -500.

That means:

**Player owes dealer 500**

### Example

Suppose you are the dealer.

After several rounds:

```text
Alex       +1200
Sam         -350
Jamie       +500
Taylor         0
```

That means:

- Alex is owed 1200 by the dealer
- Sam owes the dealer 350
- Jamie is owed 500
- Taylor is settled

The same information appears directly underneath each player's seat.

The ledger survives normal rounds, so you can keep a running balance for the whole night.

---

# Blackjack controls

Before a round:

1. Each player chooses their virtual-chip bet.
2. The dealer presses **Deal round**.

During a player's turn:

- **Hit** — draw another card
- **Stand** — end your turn
- **Double** — double the bet and take exactly one more card

The dealer then presses:

**Run dealer**

The game calculates the result.

Blackjack pays 3:2 in virtual chips.

---

# If something goes wrong

Don't worry about breaking anything.

The three most common problems are:

### "Your email is not approved"

Your email hasn't been added to:

`approved_users`

Add it in Supabase Table Editor.

### The page is blank

Usually `config.js` still has:

```text
YOUR-PROJECT
YOUR_SUPABASE_ANON_KEY
```

Replace those with your actual Supabase values.

### Login works but the table doesn't work

Check that you ran the complete `schema.sql` in Supabase SQL Editor.

If you're stuck, send me a screenshot of the error/page and I can walk you through it.

---

# Chromebook tips

You do NOT need:

- VS Code
- Linux
- Python
- Node.js
- npm
- a terminal

You can do the whole setup using:

**Chrome → GitHub → Supabase**

When editing files on GitHub, use the built-in pencil editor.

---

# Important security note

This is intentionally a friends-only **play-money** game.

The browser currently contains some game logic, so someone who deliberately knows how to use browser developer tools could tamper with a game. That is another reason this should not be connected to real money.

If you want a stronger version later, the next upgrade should move the blackjack game engine, dealer controls and ledger changes into server-side Supabase Edge Functions. That makes the server authoritative instead of trusting the browser.

