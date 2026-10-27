# DEV

## Flags

- `?dev=1` — landmark and "Meet" buttons. Also on during `npm run dev`.
- `?name=Tester` — skip the name gate.

## Cheats

| Button | Effect |
|--------|--------|
| Landmark name | Stand on that block's sidewalk |
| Meet (name) | Stand next to that person |

## Server

- Street socket: `ws://127.0.0.1:8787`, proxied by Vite at `/ws`
- `DIALOG=local` — scripted replies
- `OPENROUTER_API_KEY` plus `DIALOG=live` — model replies
- NPC talk distance is a little wider on the server than the prompt, so a just-arrived player still counts

## Test scenarios

1. Walk from Olive into City Hall Plaza. You should cross grass, not a building.
2. Stand on Third and face a wall. You should slide, not enter.
3. Meet June and ask where City Hall is. The caption names Olive Avenue.
4. Open a second window with another name. Walk together. A line with nobody in talk range shows up for the other person nearby.
5. Turn Hear off. Captions stay, the speaker stays quiet.
