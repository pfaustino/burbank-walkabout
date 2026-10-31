# Burbank Walkabout

Walk Burbank in the browser. The streets and buildings follow the real city, from OpenStreetMap. People move along the sidewalks. Step up to one and talk. Other players on the same server appear on the street with you.

You can drive a stopped car, ride a bus, or call a helicopter. Jobs show up as fares: pick someone or an order up, drop them off, and the cash in the corner goes up. The day moves from morning toward night, and the street lamps come on after dark. The corner names the time and the street you are on.

The walk is the same idea as [World of Wardom](https://github.com/pfaustino/world-of-wardom): third-person WASD, right-drag look, pedestrians that pick a nearby spot and stroll. Wardom's character models stay in that project. People here are Quaternius man and woman meshes, recolored per person.

## Run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5174 . The first screen stays on **Loading the map…** until the city is ready. Add `?dev=1` outside Vite dev to show the jump panel. `?name=` skips the name gate.

A card lists the main keys the first time. **Got it** dismisses it.

Two browser windows on that address share the street.

## On foot

| Key | Action |
|-----|--------|
| **WASD** or arrows | Walk |
| **Shift** | Run |
| Right-drag | Look |
| Wheel | Camera distance |
| **Space** | Hop |
| **E** | Talk box |
| **V** or **Mic** | Push to talk |
| **Enter** | Send the line |
| **Hear** | Speak replies on this computer |
| **F** | Drive the nearest stopped car, or board the nearest stopped bus |
| **H** | Call the helicopter |
| **M** | City map |
| **Esc** | Pause |

**F** picks whichever stopped vehicle is closer. Say something with nobody close and it goes to other players within earshot, still as text, spoken on their machine if Hear is on.

## Driving

Stand next to a car that has stopped, then press **F**.

| Key | Action |
|-----|--------|
| **W** or up | Forward |
| **S** or down | Reverse |
| **A** / **D** or left / right | Steer |
| **Shift** | Faster |
| Right-drag | Look |
| Wheel | Camera distance |
| **F** | Park and get out |
| **M** | City map |
| **Esc** | Pause |

## On the bus

**F** boards the nearest stopped bus when it is closer than a stopped car. The bus keeps its route.

| Key | Action |
|-----|--------|
| **F** | Hop off |
| **M** | City map |
| **Esc** | Pause |

## Flying

**H** sends the helicopter to you. When it lands beside you, you are in the air. **H** does nothing while you are driving or riding. **F** does nothing while you are flying.

| Key | Action |
|-----|--------|
| **W** / **S** or up / down | Fly forward or back |
| **A** / **D** or left / right | Turn |
| **Space** | Climb |
| **C** or **Ctrl** | Descend |
| **Shift** | Faster |
| **H** | Land |
| **M** | City map |
| **Esc** | Pause |

## Street map

**M** opens a north-up map of the city. Your arrow is on it. Wide streets keep their names when the view is wide. Smaller streets pick up names as you zoom in. You stay put while the map is open, and the arrow slides to the edge if you pan away from yourself.

| Key | Action |
|-----|--------|
| Drag | Pan |
| Scroll | Zoom toward the cursor |
| Double-click | Zoom in |
| **+** / **−** | Zoom |
| Arrows | Pan |
| **M** or **Esc** | Close |

**Zoom in**, **Zoom out**, and **Close** do the same thing. **Esc** closes the map and does not pause. The small map in the corner stays up while you walk. North is up. East is on the right.

## Wordnet

The dark panel above the corner map is the word stream. Rows of halfwidth kana and digits drift sideways, with real words mixed in, in the style of the falling glyphs from *The Matrix*.

The words come from lines you send and lines people say back. Little words drop out. A word from the latest lines is brighter. Before anyone has spoken, the stream uses place words such as Olive, Magnolia, and Burbank. Click the panel to enlarge it. Click again to shrink it.

## Fares

A job shows up on its own. The ribbon at the top is the current stop. Yellow is the pickup. Green is the dropoff. An arrow just under the ribbon points the way and shows the distance. The corner map marks the same spot.

One job is a person waving for a ride. The next is an order from a shop, then a ride again. Drive to the spot and stop. The ribbon switches to the dropoff. Stop there and the fare, plus a tip, adds to the cash in the corner. A quicker trip pays a larger tip. Then there is a short break before the next one.

Shops wear their OpenStreetMap names. Street blades name the road you are on.

## Voice

The microphone stays in the browser. What you say is sent as text.

1. Speech-to-text turns your voice into text (or you type).
2. That text is the only thing sent up.
3. The server asks OpenRouter when you are talking to a person on the sidewalk.
4. Fish Audio turns the reply into speech. Your browser plays that audio. With no Fish key, the browser's own voice reads the text.

Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY` and `FISH_AUDIO_API_KEY`. Without an OpenRouter key, people still answer from a short local script.

`OPENROUTER_MODEL` is any model id on your account. `DIALOG=local` skips the network even if a key is set.

## Dev panel

During `npm run dev`, or with `?dev=1`, a panel sits in the corner.

- **Address** — type a house number and a street, then Enter. You land at that address when the map has it, or halfway along the street when you leave the number out.
- **Locations** — jump to a place: the library, Town Center, City Hall, Verdugo Park, Magnolia Park, St. Joseph's Hospital, IKEA, or Walmart.
- **NPCs** — stand next to that person.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite plus the street server, with reload |
| `npm run check` | typecheck, unit tests, production build |
| `npm run test:e2e` | load the block and talk to June |

See [GDD.md](GDD.md), [DEV.md](DEV.md), and [ASSETS.md](ASSETS.md).
