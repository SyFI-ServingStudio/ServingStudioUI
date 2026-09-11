import { describe, expect, it } from 'vitest';

import { IncompatibleRunModelError, modelNumber, parseRunModel } from './runModel';

const BODY = {
  schema_version: 2,
  source_path: 'model/config/llama3_8b.json',
  config: { num_hidden_layers: 32, torch_dtype: 'bfloat16', architectures: ['LlamaForCausalLM'] },
  parameter_counts: { total: 8030261248, active: 8030261248, active_definition: 'with_embed_head' },
};

describe('parseRunModel', () => {
  it('keeps the config as it was written', () => {
    // Another project's file, whose keys differ per architecture. Narrowing it
    // would mean maintaining a union of every architecture the simulator can
    // load, and being wrong about a new one by refusing to read it.
    expect(parseRunModel(BODY).config).toEqual(BODY.config);
  });

  it('reads the parameter counts when they are there', () => {
    expect(parseRunModel(BODY).parameters).toEqual({ total: 8030261248, active: 8030261248 });
  });

  it('is readable without parameter counts', () => {
    // A model config with no counts is still a model config, and the map has
    // other things to say about it.
    const { parameter_counts: _counts, ...rest } = BODY;
    expect(parseRunModel(rest).parameters).toBeUndefined();
  });

  it('refuses a config that is not a map', () => {
    // Indexing into a string yields `undefined` for every key, so the page
    // renders a column of blanks rather than saying it could not read this.
    expect(() => parseRunModel({ ...BODY, config: 'llama3_8b' })).toThrow(
      IncompatibleRunModelError,
    );
  });

  it('reports a version it does not read as the version it got', () => {
    try {
      parseRunModel({ ...BODY, schema_version: 3 });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleRunModelError);
      expect((error as IncompatibleRunModelError).received).toBe(3);
    }
  });
});

describe('modelNumber', () => {
  it('answers with the number when the run said one', () => {
    expect(modelNumber(parseRunModel(BODY), 'num_hidden_layers')).toBe(32);
  });

  it('treats missing, non-numeric and non-finite alike', () => {
    // All three are the same answer to the reader — the run did not say — and
    // spelling them apart at each call site would produce three ways of
    // rendering one absence.
    const model = parseRunModel({
      ...BODY,
      config: { num_experts: 'many', top_k: Number.POSITIVE_INFINITY },
    });
    expect(modelNumber(model, 'num_hidden_layers')).toBeUndefined();
    expect(modelNumber(model, 'num_experts')).toBeUndefined();
    expect(modelNumber(model, 'top_k')).toBeUndefined();
    expect(modelNumber(undefined, 'num_hidden_layers')).toBeUndefined();
  });
});
