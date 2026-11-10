# Live test protocol (Breath Challenge)

The Breath Challenge asks a live heart to respond to random breathing cues, so it can only be measured with real people in front of a camera. This protocol gives honest numbers in about an hour with a small team.

## What you need

- 10+ volunteers (more is better; mix of ages and skin tones) who consent to being scanned. Pulse data is biometric: don't keep recordings unless they agree.
- A laptop with a webcam, Chrome, good front lighting (a window or a desk lamp facing the person).
- A phone or second screen to replay videos (for the attack trials).
- The app running: `npm run dev`, open http://localhost:3000. Keep http://localhost:3000/proctor open in another tab: it logs every verdict with a timestamp.

## Trials per volunteer

Run each trial once, in this order, and write down the result in the table below.

| # | Trial | What to do | Should the app say? |
|---|---|---|---|
| A | **Genuine** | Volunteer sits still, faces the light, presses **Ask the heart a question** and follows the cues with slow, deep breaths. | **The heart answered.** |
| B | **Genuine, not following** | Same, but the volunteer breathes normally and ignores the cues. | Not a pass (heart did not respond to the cues) |
| C | **Replay attack** | Record 60 s of the volunteer (phone video, face to camera, breathing normally). Play it back on the phone held in front of the webcam, then run the challenge. | Not a pass |
| D | **Virtual-camera injection** *(optional)* | Feed the same recording into the app through OBS Virtual Camera instead of the webcam, then run the challenge. | Not a pass |
| E | **Red-team switch** | During a live scan, flip **Inject a synthetic feed**. | **Synthetic.** within ~3 s |

Trial B matters: it shows the app is measuring the *response to cues*, not just the presence of a pulse.

## Recording sheet

| Volunteer | A genuine | B ignore cues | C replay | D injection | E red-team | Lighting / notes |
|---|---|---|---|---|---|---|
| 1 | PASS / FAIL / INCONCL. (diff bpm, p) | | | | | |
| 2 | | | | | | |
| … | | | | | | |

Write the **heart response (bpm)** and **p** from the result card for every Breath Challenge, not just the verdict.

## Metrics to report

Treat "pass" as "app says this is a live, responding person".

- **Genuine pass rate** (sensitivity for real people) = passes in A ÷ A trials.
- **Attack rejection rate** (specificity) = non-passes in C + D ÷ (C + D trials).
- **Ignore-cues rejection** = non-passes in B ÷ B trials.
- **Inconclusive rate** = inconclusive results ÷ all challenge trials. Report it separately; don't count it as a pass or a fail.
- Give the counts next to every percentage (for example "9 / 10 = 90%"). With 10 people each person moves a rate by 10 points, so say "pilot, n = 10".

## Tips for a fair test

- Same lighting and distance for every trial of a volunteer.
- Don't retry a failed genuine trial and report only the best one; if you retry, report both.
- Do the attacks with recordings of the same volunteers, so the attack has a real pulse in it (that is the hard case the Breath Challenge is designed for).
- If many genuine trials come back Inconclusive, improve the lighting first; that is the most common cause.
