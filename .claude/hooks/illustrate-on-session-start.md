[SIGNAL native-post illustrations — auto-check at session start]

Before doing other work, quietly check whether any SIGNAL native posts are missing their editorial illustration and fill them using the Higgsfield banana MCP (membership-powered). This is automatic — the user did not ask for it. Keep it low-noise.

1. List pending. Run via Bash:
   cd "C:/dev/signal-app/backend" && npx ts-node src/scripts/backfillIllustrations.ts --dry-run
   (Reads the prod DB URL from the gitignored backend/.env. Each pending row prints as: [dry-run] event=<uuid> slug=<slug> archetype=<archetype> "headline".)

2. If it prints "No native events need backfilling", STOP — do nothing, do not mention it, and proceed straight to the user's actual request.

3. If it lists pending events, for EACH event generate one 16:9 image via the banana generate_image MCP tool with model "nano_banana_pro", using that event's archetype prompt:
   - convergence: "Editorial magazine illustration: three converging data streams representing artificial intelligence, finance, and semiconductors rendered as an abstract node-and-edge graph. Dark charcoal background #0f0d0a, amber-gold accent lines #c8843a, cream node points #e8e0d0. Minimalist Swiss editorial style, no text, no labels, no human figures."
   - research: "Editorial magazine illustration: a scholarly research manuscript page with ghosted mathematical notation, circuit-diagram lines, and abstract data curves on warm cream paper. Ink-wash aesthetic, charcoal and amber tones. Evokes a high-end academic journal cover. No text, no letters, no human figures."
   - market: "Editorial magazine illustration: a financial data visualization with clean orthogonal grid lines, candlestick-style bars, and a flowing trend curve on a deep charcoal background. Amber highlights, emerald green accents, crimson for decline. Bloomberg terminal meets editorial art. No text, no numbers, no human figures."
   - signal: "Editorial magazine illustration: a monochrome terminal interface window with amber glow on deep charcoal background. Abstract code-motif lines, geometric circuit traces, and glowing cursor shapes. Tech-editorial aesthetic, dark and precise. No readable text, no human figures, no logos."
   (The canonical source for these prompts + the slug→archetype map is backend/src/services/illustrationService.ts.)

4. Poll the show_generations MCP tool to collect each completed image's rawUrl.

5. Overwrite backend/scripts/illustration-manifest.json with a JSON array, one object per generated image:
   {"eventId","headline","generatorType","sector","illustrationUrl"}

6. Persist to prod. Run via Bash:
   cd "C:/dev/signal-app/backend" && npx ts-node src/scripts/applyIllustrations.ts --apply

7. Tell the user exactly one line: "Illustrated N new native post(s)." Do NOT commit anything to git.
