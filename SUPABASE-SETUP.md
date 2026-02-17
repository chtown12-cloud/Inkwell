# Inkwell — Supabase Cloud Sync Setup

## 5-Minute Setup

### 1. Create a Supabase Project
- Go to [supabase.com](https://supabase.com) and create a free account
- Click **New Project**, give it a name (e.g., "inkwell"), set a database password
- Wait ~1 minute for it to provision

### 2. Run the Database Schema
- In your Supabase dashboard, go to **SQL Editor** (left sidebar)
- Click **New Query**
- Copy the entire contents of `supabase-schema.sql` and paste it in
- Click **Run** — you should see "Success" messages

### 3. Get Your API Keys
- Go to **Settings** → **API** (left sidebar)
- Copy the **Project URL** (looks like `https://xxxxx.supabase.co`)
- Copy the **anon public** key (starts with `eyJ...`)

### 4. Set Environment Variables
Create a `.env.local` file in your project root:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

For **Vercel deployment**, add these same variables in:
- Vercel Dashboard → Your Project → Settings → Environment Variables

### 5. Configure Auth (Email)
In your Supabase dashboard:
- Go to **Authentication** → **Providers**
- **Email** should be enabled by default
- For magic links, ensure **Enable Email Confirmations** is ON
- Under **URL Configuration**, set **Site URL** to your deployed URL (e.g., `https://inkwell-cht.vercel.app`)
- Add your localhost to **Redirect URLs**: `http://localhost:3000`

### 6. Deploy
Push to GitHub → Vercel auto-deploys. That's it!

## How It Works
- **Not configured?** App works exactly as before with localStorage only
- **Configured?** Login screen appears → sign in → data syncs to cloud
- **First login?** Existing localStorage data automatically migrates to cloud
- **Debounced saves:** Changes sync to cloud 1.5s after you stop editing
- **Offline cache:** localStorage always stays updated as a fallback

## Troubleshooting
- **"Invalid API key"** — double-check your anon key, make sure it's the full string
- **"Row level security"** — make sure you ran the full SQL schema including the policies
- **Magic link not arriving** — check spam folder; Supabase free tier has email limits (4/hour)
- **Data not syncing** — open browser console, look for "Cloud save failed" warnings
