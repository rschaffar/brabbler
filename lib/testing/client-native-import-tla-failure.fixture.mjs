// Actual failing module evaluation, not a fake root/JSON receipt or test catch.
await Promise.resolve();
throw new Error('CNB_TOP_LEVEL_IMPORT_FAILURE');
