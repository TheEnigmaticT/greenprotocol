import { discoverLocalCorpus } from '../../lib/local-qualification/discovery'

// Only the parent may use this exact invocation after independent review.
// This acknowledgement is not an approval bypass or proof review took place.
const args = process.argv.slice(2)
if (args.length !== 1 || args[0] !== '--review-approved') {
  process.stderr.write('DISCOVERY_REVIEW_REQUIRED\n')
  process.exitCode = 1
} else {
  try {
    const summary = discoverLocalCorpus(true)
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
  } catch (error) {
    // Emit a fixed allowlisted literal, never arbitrary messages, causes or paths.
    const message = error instanceof Error ? error.message : undefined
    const code = ['DISCOVERY_UNSAFE_PATH', 'DISCOVERY_INVALID_JSON', 'DISCOVERY_LIMIT', 'DISCOVERY_REVIEW_REQUIRED']
      .find(allowed => allowed === message) ?? 'DISCOVERY_FAILED'
    const check = error instanceof Error && 'check' in error ? error.check : undefined
    const detail = code === 'DISCOVERY_UNSAFE_PATH'
      ? ['SYMLINK_COMPONENT', 'NON_DIRECTORY_COMPONENT', 'NON_REGULAR_OR_MULTILINK', 'OPEN_IDENTITY_CHANGED', 'FILE_CHANGED', 'READ_LENGTH_CHANGED', 'EXPECTED_DIRECTORY', 'DIRECTORY_CHANGED', 'PATH_MISSING', 'ACCESS_DENIED', 'FILESYSTEM_ERROR'].find(allowed => allowed === check)
      : undefined
    process.stderr.write(code + (detail ? ':' + detail : '') + '\n')
    process.exitCode = 1
  }
}
