import { expect, test } from 'bun:test'
import { enforceNoAdditionalProperties } from './openaiShim.ts'

test('flat object schema gains additionalProperties:false', () => {
  const out = enforceNoAdditionalProperties({
    type: 'object',
    properties: { a: { type: 'string' } },
  })
  expect(out.additionalProperties).toBe(false)
})

test('object schema identified by a properties key (no explicit type) gains additionalProperties:false', () => {
  const out = enforceNoAdditionalProperties({
    properties: { a: { type: 'string' } },
  })
  expect(out.additionalProperties).toBe(false)
})

test('object schema with no properties still gains additionalProperties:false', () => {
  const out = enforceNoAdditionalProperties({ type: 'object' })
  expect(out.additionalProperties).toBe(false)
})

test('nested object under properties.x gains additionalProperties:false', () => {
  const out = enforceNoAdditionalProperties({
    type: 'object',
    properties: {
      x: {
        type: 'object',
        properties: { y: { type: 'string' } },
      },
    },
  })
  const props = out.properties as Record<string, Record<string, unknown>>
  expect(out.additionalProperties).toBe(false)
  expect(props.x.additionalProperties).toBe(false)
})

test('nested object under items gains additionalProperties:false', () => {
  const out = enforceNoAdditionalProperties({
    type: 'array',
    items: {
      type: 'object',
      properties: { y: { type: 'string' } },
    },
  })
  const items = out.items as Record<string, unknown>
  expect(items.additionalProperties).toBe(false)
})

test('tuple items array: each object member gains additionalProperties:false', () => {
  const out = enforceNoAdditionalProperties({
    type: 'array',
    items: [
      { type: 'object', properties: { a: { type: 'string' } } },
      { type: 'string' },
    ],
  })
  const items = out.items as Array<Record<string, unknown>>
  expect(items[0].additionalProperties).toBe(false)
  expect('additionalProperties' in items[1]).toBe(false)
})

test('schemas inside anyOf gain additionalProperties:false', () => {
  const out = enforceNoAdditionalProperties({
    anyOf: [
      { type: 'object', properties: { a: { type: 'string' } } },
      { type: 'null' },
    ],
  })
  const anyOf = out.anyOf as Array<Record<string, unknown>>
  expect(anyOf[0].additionalProperties).toBe(false)
  expect('additionalProperties' in anyOf[1]).toBe(false)
})

test('schemas inside oneOf and allOf gain additionalProperties:false', () => {
  const out = enforceNoAdditionalProperties({
    oneOf: [{ type: 'object', properties: {} }],
    allOf: [{ type: 'object', properties: { a: { type: 'number' } } }],
  })
  const oneOf = out.oneOf as Array<Record<string, unknown>>
  const allOf = out.allOf as Array<Record<string, unknown>>
  expect(oneOf[0].additionalProperties).toBe(false)
  expect(allOf[0].additionalProperties).toBe(false)
})

test('objects inside $defs and definitions gain additionalProperties:false', () => {
  const out = enforceNoAdditionalProperties({
    type: 'object',
    properties: { ref: { $ref: '#/$defs/Thing' } },
    $defs: {
      Thing: { type: 'object', properties: { a: { type: 'string' } } },
    },
    definitions: {
      Other: { type: 'object', properties: { b: { type: 'string' } } },
    },
  })
  const defs = out.$defs as Record<string, Record<string, unknown>>
  const definitions = out.definitions as Record<string, Record<string, unknown>>
  expect(defs.Thing.additionalProperties).toBe(false)
  expect(definitions.Other.additionalProperties).toBe(false)
})

test('an already-false additionalProperties is unchanged', () => {
  const out = enforceNoAdditionalProperties({
    type: 'object',
    properties: { a: { type: 'string' } },
    additionalProperties: false,
  })
  expect(out.additionalProperties).toBe(false)
})

test('an explicit additionalProperties (e.g. a schema or true) is not overwritten', () => {
  const out = enforceNoAdditionalProperties({
    type: 'object',
    properties: { a: { type: 'string' } },
    additionalProperties: { type: 'string' },
  })
  expect(out.additionalProperties).toEqual({ type: 'string' })

  const outTrue = enforceNoAdditionalProperties({
    type: 'object',
    properties: {},
    additionalProperties: true,
  })
  expect(outTrue.additionalProperties).toBe(true)
})

test('{type:"string"} is left untouched', () => {
  const out = enforceNoAdditionalProperties({ type: 'string' })
  expect('additionalProperties' in out).toBe(false)
  expect(out).toEqual({ type: 'string' })
})

test('the original input object is not mutated (deep copy)', () => {
  const input = {
    type: 'object',
    properties: {
      x: { type: 'object', properties: { y: { type: 'string' } } },
    },
    items: { type: 'object', properties: {} },
  }
  const snapshot = JSON.parse(JSON.stringify(input))
  const out = enforceNoAdditionalProperties(input)

  // Original untouched.
  expect(input).toEqual(snapshot)
  expect('additionalProperties' in input).toBe(false)
  expect('additionalProperties' in (input.properties.x as Record<string, unknown>)).toBe(false)
  // Output is a different object.
  expect(out).not.toBe(input)
  expect(out.properties).not.toBe(input.properties)
})

test('the Gmail-style MCP tool case that triggered the 400 is fixed', () => {
  // Reproduces a tool whose top-level parameters is an object with no explicit
  // additionalProperties, plus a nested object property — the shape that made
  // OpenAI reject tools[N].parameters with invalid_function_parameters.
  const out = enforceNoAdditionalProperties({
    type: 'object',
    properties: {
      to: { type: 'array', items: { type: 'string' } },
      headers: {
        type: 'object',
        properties: { 'In-Reply-To': { type: 'string' } },
      },
    },
    required: ['to'],
  })
  const props = out.properties as Record<string, Record<string, unknown>>
  expect(out.additionalProperties).toBe(false)
  expect(props.headers.additionalProperties).toBe(false)
})
