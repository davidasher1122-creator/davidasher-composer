# David Asher — Composer

The film-scoring site. A sibling of
[david-asher-music-website](https://github.com/davidasher1122-creator/david-asher-music-website)
and [elephant-shoez-website](https://github.com/davidasher1122-creator/elephant-shoez-website):
the same pixel-dissolve engine, a darker cinematic palette, and a hero loop that carries the music.

Single page: `index.html`, `css/styles.css`, `js/main.js`. No build step.

## Preview

The pixel effect reads video frames, which browsers only allow over http (not `file://`).

```bash
python3 -m http.server 5175
```

Open http://localhost:5175

- `?gate=off` skips the phone "wipe to find Enter" screen while testing.

## How it behaves

- **Desktop:** the loop fills the screen and dissolves on arrival and under the mouse.
  It starts muted (browsers require this); the **Sound on** button or a click on the
  picture brings the music in. Scrolling away pauses it.
- **Phones:** the loop is a full-screen entry. Wipe it to find **Enter**. Enter restarts
  the loop with sound, scatters it, then opens the site.
- **Backgrounds:** each section has its wallpaper (Bio 1, Music 2, Links 3, Contact 4),
  dissolving into the next as you scroll. Music lets its wallpaper come forward.
- **Player:** custom controls driving SoundCloud's widget for
  https://soundcloud.com/david-asher-cinematic. New uploads there show up here on
  their own. If SoundCloud's widget can't be driven (some phones), SoundCloud's own
  player appears in its place.
- **Contact:** the form opens the visitor's email app addressed to davidasher1122@gmail.com.

## Where things are

| What | Where |
|------|-------|
| Hero loop (with music) | `assets/video/hero-loop.mp4` |
| Hero poster (shown before the video loads) | `assets/img/hero-poster.jpg` |
| Wallpapers | `assets/img/wallpaper-1.jpg` … `wallpaper-4.jpg` |
| Section photos | `assets/img/photo-1.jpg` … `photo-3.jpg` |
| Contact headshot | `assets/img/headshot.jpg` |
| Host | `assets/img/host.png` |
| Host pointing pose (optional) | `assets/img/host-point.png`; see below |
| Links page | `index.html`, the `#links` section |
| Contact email | `index.html`, `#inquiry-form` `data-email` and the mailto link |
| Effect tuning | `js/main.js`, the `createPixelField(heroCanvas, …)` call and `moods` |

## Host pointing pose

The host stands beside the contact card with a gentle sway. To make him gesture,
export a second image of him **in the same position and scale** but pointing right,
as a transparent PNG the same size as `host.png` (377 × 1122), and save it as
`assets/img/host-point.png`. The page picks it up and loops between the two poses.
No code change needed.

## Replacing the hero loop

H.264 MP4 with AAC audio, 1920×1080, under 20 MB, saved over `assets/video/hero-loop.mp4`.
Re-export `hero-poster.jpg` from its first frame so the poster matches.
