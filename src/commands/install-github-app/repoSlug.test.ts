import assert from 'node:assert/strict'
import test from 'node:test'

import { extractGitHubRepoSlug } from './repoSlug.ts'

test('keeps owner/repo input as-is', () => {
  assert.equal(extractGitHubRepoSlug('verickwayne/limitless'), 'verickwayne/limitless')
})

test('extracts slug from https GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('https://github.com/verickwayne/limitless'),
    'verickwayne/limitless',
  )
  assert.equal(
    extractGitHubRepoSlug('https://www.github.com/verickwayne/limitless.git'),
    'verickwayne/limitless',
  )
})

test('extracts slug from ssh GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('git@github.com:verickwayne/limitless.git'),
    'verickwayne/limitless',
  )
  assert.equal(
    extractGitHubRepoSlug('ssh://git@github.com/verickwayne/limitless'),
    'verickwayne/limitless',
  )
})

test('rejects malformed or non-GitHub URLs', () => {
  assert.equal(extractGitHubRepoSlug('https://gitlab.com/verickwayne/limitless'), null)
  assert.equal(extractGitHubRepoSlug('https://github.com/Gitlawb'), null)
  assert.equal(extractGitHubRepoSlug('not actually github.com/verickwayne/limitless'), null)
  assert.equal(
    extractGitHubRepoSlug('https://evil.example/?next=github.com/verickwayne/limitless'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://github.com.evil.example/verickwayne/limitless'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://example.com/github.com/verickwayne/limitless'),
    null,
  )
})
