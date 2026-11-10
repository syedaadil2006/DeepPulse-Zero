# DeepPulse-Zero — upload-mode evaluation

Run on 27 clips through the real in-browser pipeline (POS pulse extraction, 30 FPS frame stepping), November 2026.

## Data

| Set | Clips | Source | Licence |
|---|---|---|---|
| Real people on camera | 11 | Pexels stock clips 5944685, 5981447, 6174925, 6658126, 6883835, 7821612, 8048249, 8246863, 8724213, 8724215, 8902251 | Pexels licence |
| Fully AI-generated people | 15 | SynthForensics sample, one clip per generator (CogVideoX, daVinci-MagiHuman, Helios, LTX-2.3, Magi-1, SkyReels-v2, Wan 2.1, Self-Forcing; image- and text-to-video) — `huggingface.co/datasets/SynthForensics/SynthForensics_sample` | CC BY-NC 4.0 |
| Face-swap deepfake | 1 | RepresentUs “Dictators – Kim Jong-Un” (Wikimedia Commons) | CC BY 3.0 |

## Result with the shipped rule (blood colour > 22° from haemoglobin → “Suspicious”)

| | Flagged | Inconclusive | Passed as alive |
|---|---|---|---|
| Real (11) | **0** | 0 | 11 |
| Fake (16) | **5** | 6 | 5 |

- **False alarms on real people: 0 of 11.**
- **Fakes caught: 5 of 16 (31%)**, or 5 of 10 fakes long enough to score.
- 6 generated clips are 4–5 s long, below the ~6 s the pulse check needs, so they come back Inconclusive.
- Missed: daVinci-MagiHuman (i2v), CogVideoX (i2v), Self-Forcing, Wan 2.1 (t2v), and the Kim Jong-un face-swap.

**Caveat:** the 22° threshold was chosen on these same 27 clips, so these numbers are optimistic. Re-test on a larger, held-out set before quoting them as accuracy.

## What each signal did

| Signal | Real people | Fakes | Verdict use |
|---|---|---|---|
| Pulse present (no-pulse share) | 0–15% no pulse | 0–2% no pulse — every fake showed a pulse-like signal | Kept: only catches frozen/injected feeds (0 of 16 here) |
| Face–neck pulse sync | −0.11 … 0.50 | −0.55 … 0.70 | **Removed from verdict**: no separation; falsely flagged 5 of 11 real people at the old 0.3 cut-off |
| Blood colour (angle from haemoglobin signature, de Haan & van Leest 2014) | 11–21° | 9–36°; 6 of 14 scored fakes above 22° | **Used**: > 22° → Suspicious |

## Raw results

| Truth | Clip | Length (s) | Old verdict | No pulse | Median BPM | Face–neck sync | Blood colour | In phase |
|---|---|---|---|---|---|---|---|---|
| REAL | 5944685 | 10 | Likely alive | 0% | – | no neck | 14° | 100% |
| REAL | 5981447 | 25.9 | Likely alive | 0% | 70 | no neck | 16° | 90% |
| REAL | 6174925 | 13.8 | Likely alive | 0% | 62 | 0.50 | 13° | 100% |
| REAL | 6658126 | 14.6 | Suspicious | 0% | – | −0.03 | 15° | 88% |
| REAL | 6883835 | 29 | Suspicious | 0% | 46 | 0.16 | 14° | 96% |
| REAL | 7821612 | 11.3 | Suspicious | 0% | 48 | −0.11 | 20° | 100% |
| REAL | 8048249 | 13.6 | Likely alive | 0% | 57 | 0.38 | 21° | 24% |
| REAL | 8246863 | 6.2 | Likely alive | 0% | – | 0.48 | 18° | 0% |
| REAL | 8724213 | 43.5 | Suspicious | 0% | 56 | 0.12 | 18° | 67% |
| REAL | 8724215 | 46.2 | Suspicious | 0% | 49 | 0.14 | 17° | 95% |
| REAL | 8902251 | 16.4 | Likely alive | 15% | – | no neck | 11° | 69% |
| FAKE | ltx-2.3 i2v | 5 | Likely alive | 0% | – | 0.14 | **29°** | 56% |
| FAKE | magi-1 t2v | 4 | Inconclusive | 0% | 111 | −0.02 | 25° | 100% |
| FAKE | daVinci-MagiHuman t2v | 5 | Inconclusive | 0% | – | no neck | – | – |
| FAKE | helios t2v | 4 | Inconclusive | 0% | – | no neck | – | – |
| FAKE | daVinci-MagiHuman i2v | 5 | Likely alive | 0% | – | 0.30 | 15° | 100% |
| FAKE | skyreels-v2 t2v | 4 | Inconclusive | 0% | 51 | 0.39 | 11° | 100% |
| FAKE | cogvideox t2v | 6.1 | Likely alive | 0% | – | 0.43 | **34°** | 40% |
| FAKE | cogvideox i2v | 6.1 | Likely alive | 0% | – | 0.37 | 11° | 100% |
| FAKE | helios i2v | 4 | Inconclusive | 0% | 45 | 0.70 | 13° | 100% |
| FAKE | ltx-2.3 t2v | 5 | Likely alive | 0% | – | −0.55 | **25°** | 100% |
| FAKE | self-forcing t2v | 5.1 | Likely alive | 0% | – | −0.06 | 15° | 100% |
| FAKE | skyreels-v2 i2v | 4 | Inconclusive | 0% | – | 0.30 | 16° | 100% |
| FAKE | wan2.1 i2v | 5.1 | Likely alive | 0% | – | 0.34 | **29°** | 100% |
| FAKE | magi-1 i2v | 5 | Likely alive | 0% | 123 | 0.47 | **36°** | 19% |
| FAKE | wan2.1 t2v | 5.1 | Likely alive | 0% | – | −0.16 | 9° | 100% |
| FAKE | Kim Jong-un face-swap | 49.4 | Suspicious | 2% | 41 | 0.20 | 12° | 100% |

“Old verdict” is the face–neck rule this run replaced. Spot-checked after the change: wan2.1 i2v → Suspicious, real 7821612 → Likely alive.

## Kaggle paired face-swaps (UniData preview)

`kaggle.com/datasets/unidpro/deepfake-videos-dataset` (CC BY-NC-ND 4.0): the free preview has 5 people, each as the real original video and a deepfake of that same video with a generated face swapped in. Matched pairs are the hardest case: same body, lighting and camera.

| Pair | Real original | Deepfake |
|---|---|---|
| 1 | Likely alive · 21° | **Suspicious · 37°** (caught) |
| 2 | **Suspicious · 28°** (false alarm) | Inconclusive · 18° (only 4.5 s) |
| 3 | Likely alive · 22° | **Suspicious · 33°** (caught) |
| 4 | Likely alive · 15° | Likely alive · 14° (missed) |
| 5 | Likely alive · 19° | **Suspicious · 23°** (caught) |

**3 of 5 deepfakes caught, 1 of 5 real people falsely flagged, 1 inconclusive.** Face–neck sync again did not separate them (real −0.28…0.61, fake −0.60…0.72).

## Tuning the blood-colour cut-off on all clips

Pooling every clip with a blood-colour reading (16 real, 19 fake: the 27 above minus the two faceless clips, plus the 10 Kaggle videos), the cut-off that best trades catches against false alarms (Youden's J) is **> 22°**, the value already shipped.

| Cut-off | Fakes caught | Real people flagged |
|---|---|---|
| > 22° (shipped) | 9 / 19 | 1 / 16 |
| > 25° | 6 / 19 | 1 / 16 |
| > 28° | 6 / 19 | 0 / 16 |

**Leave-one-out check** (each clip judged by a cut-off chosen without it, so the score is never on tuning data): **8 of 19 fakes caught (42%), 1 of 16 real people flagged (6%).** These are per-clip blood-colour readings; short clips that come back Inconclusive are not counted as catches. 35 clips is still small: quote these as a pilot result, not accuracy.

## Upload verdict, measured end to end in the app (shipped)

All 37 clips (16 real, 21 fake: the 27 above plus the 10 Kaggle videos) were uploaded through the running app in Chrome, and the numbers were read off each upload report. A clip is **Suspicious** when the pulse colour is more than 22° off haemoglobin, **or** the AI-image model averages at least 45% over 8 sampled frames. The image score also counts on clips too short for a pulse reading. Leave-one-out: every clip is judged by cut-offs chosen without it.

| Rule | Fakes caught | Real people flagged |
|---|---|---|
| Blood colour only | 6 / 21 | 1 / 16 |
| Image model only | 6 / 21 | 5 / 16 |
| **Both (shipped)** | **12 / 21 (57%)** | **1 / 16 (6%)** |

Accuracy 73% · precision 92% · recall 57% · specificity 94% · F1 0.71.

The two signals catch different fakes. Blood colour catches, among others, CogVideoX t2v, Wan 2.1 i2v, Magi-1 i2v and Kaggle face-swaps 1 and 3; the image model catches, among others, Self-Forcing, Wan 2.1 t2v, the Kim Jong-un face-swap and the short Magi-1, daVinci and Helios t2v clips.

**Correction:** an earlier version of this section reported 67% caught / 19% flagged. That figure combined browser blood-colour readings with image scores computed offline in Python, and the image model scores video frames differently inside the app. The table above replaces it.

**Engine note:** live and Meeting modes now use MediaPipe's GPU Face Landmarker (about 3× faster, so the page stays smooth). Upload mode keeps the original Face Mesh: re-running this test with the new landmarker, blood colour fell to chance level (3 / 21 caught, 3 / 16 flagged).

## Photo mode

Photos have no pulse, so Photo mode uses the **Community Forensics ViT** (Park & Owens, CVPR 2025; trained on 4,803 generators; corrected July-2026 weights, 4-bit ONNX, run in the browser) plus a file-metadata scan (C2PA, IPTC `trainedAlgorithmicMedia`, generator names, camera maker).

Test set: one still frame (ffmpeg, metadata stripped) from each of the 16 real-person videos and 21 fake videos above. The browser scores match a Python reference run of the full-precision model.

| | Flagged "Likely AI-generated" (≥ 65%) |
|---|---|
| Real people (16) | 1 (pexels 8724215, 68%) |
| Fakes (21) | 3 (Kim Jong-un face-swap 99%, Wan 2.1 t2v 82%, Helios t2v 70%) |

**Ranking quality: AUC 0.63** (0.5 = coin flip; fp32 reference 0.60). On frames from AI *videos* and face-swaps this model is weak, so a low score is never shown as "real". The metadata check is reliable when an AI tool labels its output (verified on a Stable Diffusion PNG) but metadata is easy to strip.

### Photo mode on real AI photos (OpenFake)

`ComplexDataLab/OpenFakeTiny`, core test split (CC BY-NC 4.0, 2025): 3 of its 8 file chunks, read by byte range, **395 images: 205 real photos and 190 AI images from 12 generators**, many released after the detector was trained (Z-Image Turbo, FLUX.2 Klein, GPT-image-1.5, Midjourney 7, Veo 3, Wan 2.5, Recraft v3, Seedream 5, Ideogram 2, Illustrious and others). Scored with the app's 4-bit model in Python (scores match the browser).

**Ranking quality: AUC 0.91.**

At the shipped "Likely AI-generated" cut-off (≥ 65%):

| | Flagged as AI | Not flagged |
|---|---|---|
| AI images (190) | 46 | 144 |
| Real photos (205) | **0** | 205 |

Accuracy 63.5% · **precision 100%** · recall 24.2% · **specificity 100%** · F1 0.39.

With a cut-off chosen by cross-validation (pick on 2 chunks, test on the third, rotate; every number is from unseen images):

| | Flagged as AI | Not flagged |
|---|---|---|
| AI images (190) | 143 | 47 |
| Real photos (205) | 25 | 180 |

Accuracy **81.8%** · precision 85.1% · recall 75.3% · specificity 87.8% · F1 0.80.

**Why the app does not use the lower cut-off:** it is about 0.1%, and at that level 14 of 16 real *webcam/video frames* from the earlier test were flagged. Noisy camera frames score higher than clean photos. So the app keeps "Likely AI-generated" at 65% (no real photo flagged) and shows **Uncertain** for scores of 1–65% instead of "No AI signs found": on OpenFake that moves 59% of AI images out of the reassuring verdict while only 2% of real photos become Uncertain.

Recall by generator at the 65% cut-off: Illustrious 72%, Aurora 67%, Midjourney 7 30%, Z-Image Turbo 23%, Wan 2.5 14%, FLUX.2 Klein / GPT-image-1.5 / Veo 3 / Recraft v3 0% (the newest photorealistic generators are the hardest).

None of the reported metrics reaches 90% at once: the honest best is 81.8% accuracy (cross-validated), or 100% precision and specificity with 24% recall at the strict cut-off.

## Not covered

- Live webcam, Meeting mode and the Breath Challenge (the strongest check) were not part of this upload test.
- Small sample, stock footage only, one face-swap. Larger sets (FaceForensics++, Celeb-DF, DFDC, the gated 914k-clip `belkhir-nacim/deepfake-videos`) need an access request.
