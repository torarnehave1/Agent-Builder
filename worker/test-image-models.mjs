// Three image models, three different parameter sets — and a request must carry only what the
// selected model actually takes.
//
// Phoenix 1.0 was added as a chat model choice on 2026-09-30 alongside Lucid Origin. They are not
// interchangeable: Phoenix has a negative_prompt and Lucid Origin has none, their guidance ranges
// differ (2-10 vs 0-10), num_steps caps at 50 / 40 / 20, and the sides cap at 2048 / 2500 / 2048.
//
// The reason this is a test and not a comment: checked against the live API the same day, Lucid
// Origin does NOT reject a negative_prompt it has no field for — it answers 200 and ignores it.
// So nothing fails loudly if the gate breaks; the control just quietly stops doing anything, the
// same way width/height were advertised in the generate_image schema and dropped by the executor.
//
//     node test-image-models.mjs
import { buildImageInput, IMAGE_MODEL_LIMITS, parseAspectRatio } from './image-models.js'

const SDXL = '@cf/bytedance/stable-diffusion-xl-lightning'
const LUCID = '@cf/leonardo/lucid-origin'
const PHOENIX = '@cf/leonardo/phoenix-1.0'

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

// 1. Phoenix 1.0 is a known model at all — the whole point of the change.
{
  const r = buildImageInput(PHOENIX, { prompt: 'a red cube' })
  check('Phoenix 1.0 is a supported image model', !r.error, JSON.stringify(r))
  check('  and its default side is its own 1024, not Lucid\'s 1120',
    r.input.width === 1024 && r.input.height === 1024, JSON.stringify(r.input))
}

// 2. negative_prompt reaches the models that have the field, and no further.
{
  const body = { prompt: 'a red cube', negative_prompt: 'text, watermark' }
  for (const [model, name] of [[PHOENIX, 'Phoenix 1.0'], [SDXL, 'SDXL Lightning']]) {
    const r = buildImageInput(model, body)
    check(`${name} receives negative_prompt`, r.input.negative_prompt === 'text, watermark', JSON.stringify(r.input))
    check(`  ${name} is not flagged as ignoring it`, r.negativePromptIgnored === false, String(r.negativePromptIgnored))
  }
  const lucid = buildImageInput(LUCID, body)
  check('Lucid Origin is NOT sent negative_prompt', !('negative_prompt' in lucid.input), JSON.stringify(lucid.input))
  check('  and the caller is told it was dropped', lucid.negativePromptIgnored === true, String(lucid.negativePromptIgnored))
}

// 3. An empty or whitespace negative_prompt is not sent as an empty string (minLength: 1).
for (const empty of ['', '   ', undefined, null]) {
  const r = buildImageInput(PHOENIX, { prompt: 'a red cube', negative_prompt: empty })
  check(`negative_prompt ${JSON.stringify(empty)} is omitted, not sent empty`,
    !('negative_prompt' in r.input) && r.negativePromptIgnored === false, JSON.stringify(r.input))
}

// 4. guidance is clamped per model — and guidance 0, legal for Lucid Origin, survives.
// `if (body.guidance)` used to throw it away as falsy.
{
  const zero = buildImageInput(LUCID, { prompt: 'x', guidance: 0 })
  check('guidance 0 is kept for Lucid Origin (not dropped as falsy)', zero.input.guidance === 0, JSON.stringify(zero.input))

  const low = buildImageInput(PHOENIX, { prompt: 'x', guidance: 0 })
  check('guidance 0 is raised to Phoenix\'s documented minimum of 2', low.input.guidance === 2, JSON.stringify(low.input))

  const high = buildImageInput(PHOENIX, { prompt: 'x', guidance: 99 })
  check('guidance 99 is clamped to Phoenix\'s maximum of 10', high.input.guidance === 10, JSON.stringify(high.input))

  const loose = buildImageInput(SDXL, { prompt: 'x', guidance: 12.5 })
  check('SDXL guidance passes through unclamped (no documented range)', loose.input.guidance === 12.5, JSON.stringify(loose.input))

  const unset = buildImageInput(PHOENIX, { prompt: 'x' })
  check('no guidance sent means no guidance field', !('guidance' in unset.input), JSON.stringify(unset.input))

  const blank = buildImageInput(PHOENIX, { prompt: 'x', guidance: '' })
  check('an empty guidance string is treated as unset, not as 0', !('guidance' in blank.input), JSON.stringify(blank.input))
}

// 5. num_steps caps differ: 50 Phoenix, 40 Lucid, 20 SDXL. A request for 50 must not be
// forwarded verbatim to SDXL, which documents a maximum of 20.
{
  const expected = [[PHOENIX, 50], [LUCID, 40], [SDXL, 20]]
  for (const [model, cap] of expected) {
    const r = buildImageInput(model, { prompt: 'x', num_steps: 500 })
    check(`num_steps 500 clamps to ${cap} for ${IMAGE_MODEL_LIMITS[model].label}`, r.input.num_steps === cap, JSON.stringify(r.input))
  }
  const zero = buildImageInput(PHOENIX, { prompt: 'x', num_steps: 0 })
  check('num_steps 0 is raised to the minimum of 1', zero.input.num_steps === 1, JSON.stringify(zero.input))

  const alias = buildImageInput(PHOENIX, { prompt: 'x', steps: 12 })
  check('the `steps` alias is accepted as num_steps', alias.input.num_steps === 12, JSON.stringify(alias.input))

  const unset = buildImageInput(PHOENIX, { prompt: 'x' })
  check('no steps sent means no num_steps field', !('num_steps' in unset.input), JSON.stringify(unset.input))
}

// 6. Sides are clamped to each model's own maximum, and 2500 is Lucid's alone.
{
  const lucid = buildImageInput(LUCID, { prompt: 'x', width: 4000, height: 4000 })
  check('Lucid Origin clamps a side to 2500', lucid.input.width === 2500 && lucid.input.height === 2500, JSON.stringify(lucid.input))

  const phoenix = buildImageInput(PHOENIX, { prompt: 'x', width: 4000, height: 4000 })
  check('Phoenix 1.0 clamps a side to 2048, not to Lucid\'s 2500', phoenix.input.width === 2048 && phoenix.input.height === 2048, JSON.stringify(phoenix.input))

  const tiny = buildImageInput(PHOENIX, { prompt: 'x', width: 1, height: 0 })
  check('a zero/one-pixel side is raised to 256', tiny.input.width === 256 && tiny.input.height === 256, JSON.stringify(tiny.input))

  const preset = buildImageInput(PHOENIX, { prompt: 'x', width: 1120, height: 630 })
  check('an in-range preset passes through untouched', preset.input.width === 1120 && preset.input.height === 630, JSON.stringify(preset.input))
}

// 7. seed: 0 is a legal seed and must survive; a negative seed is not (minimum: 0).
{
  const zero = buildImageInput(PHOENIX, { prompt: 'x', seed: 0 })
  check('seed 0 is kept', zero.input.seed === 0, JSON.stringify(zero.input))
  const neg = buildImageInput(PHOENIX, { prompt: 'x', seed: -5 })
  check('a negative seed is raised to 0', neg.input.seed === 0, JSON.stringify(neg.input))
  const unset = buildImageInput(PHOENIX, { prompt: 'x' })
  check('no seed sent means no seed field', !('seed' in unset.input), JSON.stringify(unset.input))
}

// 8. --ar in the prompt is stripped from the text and scaled at the model's OWN base size.
{
  const r = buildImageInput(PHOENIX, { prompt: 'a red cube --ar 16:9' })
  check('--ar is removed from the prompt text', r.prompt === 'a red cube', JSON.stringify(r.prompt))
  check('--ar 16:9 gives a landscape frame', r.input.width > r.input.height, JSON.stringify(r.input))
  check('  both sides are multiples of 8', r.input.width % 8 === 0 && r.input.height % 8 === 0, JSON.stringify(r.input))

  const lucidAr = buildImageInput(LUCID, { prompt: 'a red cube --ar 16:9' })
  check('--ar scales from each model\'s own default, so Lucid comes out wider than Phoenix',
    lucidAr.input.width > r.input.width, `lucid=${lucidAr.input.width} phoenix=${r.input.width}`)

  const explicit = buildImageInput(PHOENIX, { prompt: 'a red cube --ar 16:9', width: 800, height: 800 })
  check('an explicit width/height overrides --ar', explicit.input.width === 800 && explicit.input.height === 800, JSON.stringify(explicit.input))

  const noAr = parseAspectRatio('plain prompt', 1024)
  check('a prompt without --ar is returned unchanged at the base size',
    noAr.cleanPrompt === 'plain prompt' && noAr.width === 1024 && noAr.height === 1024, JSON.stringify(noAr))
}

// 9. An unknown model is refused, and the error names what IS available — rather than being
// forwarded to env.AI.run to fail there after the caller has been charged nothing but confused.
{
  const r = buildImageInput('@cf/leonardo/phoenix-2.0', { prompt: 'x' })
  check('an unknown model is refused', Boolean(r.error) && !r.input, JSON.stringify(r))
  check('  and the refusal lists the supported models',
    Array.isArray(r.supported) && r.supported.includes(PHOENIX) && r.supported.includes(LUCID), JSON.stringify(r.supported))
}

// 10. No model's input ever carries a field outside that model's documented schema.
{
  const ALLOWED = new Set(['prompt', 'width', 'height', 'negative_prompt', 'guidance', 'num_steps', 'seed'])
  const kitchenSink = { prompt: 'x', negative_prompt: 'y', guidance: 5, num_steps: 10, seed: 1, width: 900, height: 900, strength: 0.5, nonsense: true }
  for (const model of Object.keys(IMAGE_MODEL_LIMITS)) {
    const r = buildImageInput(model, kitchenSink)
    const extra = Object.keys(r.input).filter(k => !ALLOWED.has(k))
    check(`${IMAGE_MODEL_LIMITS[model].label} sends no undocumented field`, extra.length === 0, extra.join(', '))
    if (!IMAGE_MODEL_LIMITS[model].negativePrompt) {
      check(`  ${IMAGE_MODEL_LIMITS[model].label} still has no negative_prompt under a full body`,
        !('negative_prompt' in r.input), JSON.stringify(r.input))
    }
  }
}

console.log(failures === 0 ? '\nAll image-model checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
