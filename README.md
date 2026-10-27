# Burbank Walkabout

Walk a downtown Burbank slice in the browser. The buildings and streets are the real downtown, from OpenStreetMap. People move along the sidewalks. Step up to one and talk. Other players on the same server appear on the street with you.

The walk is the same idea as [World of Wardom](https://github.com/pfaustino/world-of-wardom): third-person WASD, right-drag look, pedestrians that pick a nearby spot and stroll. Wardom's character models stay in that project. People here are Quaternius man and woman meshes, recolored per person.

## Run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5174 . Add `?dev=1` outside Vite dev if you want the corner list.

Two browser windows on that address share the street.

## Voice

The microphone stays in the browser. What you say is sent as text.

1. Speech-to-text turns your voice into text (or you type).
2. That text is the only thing sent up.
3. The server asks OpenRouter when you are talking to a person on the sidewalk.
4. Fish Audio turns the reply into speech. Your browser plays that audio. With no Fish key, the browser's own voice reads the text.

Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY` and `FISH_AUDIO_API_KEY`. Without an OpenRouter key, people still answer from a short local script.

`OPENROUTER_MODEL` is any model id on your account. `DIALOG=local` skips the network even if a key is set.

## Controls

- **WASD** or arrows — walk
- **Shift** — run
- **Right-drag** — look
- **Wheel** — camera distance
- **Space** — hop
- **E** — talk box
- **V** or **Mic** — push to talk
- **Enter** — send the line
- **Hear** — speak replies on this computer
- **Esc** — pause

Say something with nobody close and it goes to other players within earshot, still as text, spoken on their machine if Hear is on.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite plus the street server, with reload |
| `npm run check` | typecheck, unit tests, production build |
| `npm run test:e2e` | load the block and talk to June |

See [GDD.md](GDD.md), [DEV.md](DEV.md), and [ASSETS.md](ASSETS.md).
