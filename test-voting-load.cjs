
"use strict";

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");

const {
  initializeApp,
  deleteApp
} = require("firebase-admin/app");

const {
  getFirestore,
  FieldValue
} = require("firebase-admin/firestore");

// =====================================================
// SAFETY: EMULATOR ONLY
// =====================================================

const PROJECT_ID = "demo-voting-load";

if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.GCLOUD_PROJECT !== PROJECT_ID
) {
  throw new Error(
    "SAFETY ERROR: Refusing to run outside " +
    "the dedicated Firestore emulator."
  );
}

const app = initializeApp({
  projectId: PROJECT_ID
});

const db = getFirestore(app);

const collection = db.collection("votes_2026_2027");

const sizes = [10, 50, 100];

// =====================================================
// TEST DATA
// =====================================================

const presenters = [
  "Botond Bolgár",
  "Tereza Kárníková",
  "Deepak Kumar Bhuyan",
  "Aparna Vijayalekshmi Muraleedharan"
];

function createVote(uid) {
  return {
    participant: `${uid}@natur.cuni.cz`,
    uid: uid,
    seminar: "Seminar 1",

    presentations: presenters.map((name, index) => ({
      name: name,
      score: [8, 9, 7, 10][index],
      comment: ""
    })),

    timestamp: FieldValue.serverTimestamp()
  };
}

// =====================================================
// STATISTICS
// =====================================================

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(
    values.length - 1,
    Math.ceil(values.length * p) - 1
  );

  return values[index];
}

// =====================================================
// CONCURRENT WRITE TEST
// =====================================================

async function runBatch(count) {
  console.log("");
  console.log("======================================");
  console.log(`STARTING TEST: ${count} concurrent votes`);
  console.log("======================================");

  const runId = `load${count}_${Date.now()}`;

  const started = performance.now();

  const results = await Promise.allSettled(
    Array.from({ length: count }, async (_, i) => {
      const uid = `${runId}_user${i}`;

      const documentId = `Seminar_1_${uid}`;

      const docRef = collection.doc(documentId);

      const writeStarted = performance.now();

      await docRef.create(createVote(uid));

      return {
        uid: uid,
        ms: performance.now() - writeStarted
      };
    })
  );

  // ===================================================
  // CHECK WRITE RESULTS
  // ===================================================

  const failures = results.filter(
    result => result.status === "rejected"
  );

  const successful = results.filter(
    result => result.status === "fulfilled"
  );

  const timings = successful
    .map(result => result.value.ms)
    .sort((a, b) => a - b);

  // ===================================================
  // VERIFY STORED DOCUMENTS
  // ===================================================

  const documents = await Promise.all(
    Array.from({ length: count }, (_, i) => {
      const uid = `${runId}_user${i}`;

      return collection
        .doc(`Seminar_1_${uid}`)
        .get();
    })
  );

  const stored = documents.filter(
    document => document.exists
  ).length;

  assert.equal(
    failures.length,
    0,
    "Failed writes: " +
    failures
      .map(result => String(result.reason))
      .join("; ")
  );

  assert.equal(
    stored,
    count,
    "Some votes are missing from Firestore."
  );

  // ===================================================
  // VERIFY CONTENTS
  // ===================================================

  for (let i = 0; i < documents.length; i++) {
    const expectedUid = `${runId}_user${i}`;

    const data = documents[i].data();

    assert.equal(
      data.uid,
      expectedUid,
      "Incorrect UID in stored vote."
    );

    assert.equal(
      data.seminar,
      "Seminar 1",
      "Incorrect seminar."
    );

    assert.equal(
      data.presentations.length,
      presenters.length,
      "Incorrect number of presentations."
    );

    for (let j = 0; j < presenters.length; j++) {
      assert.equal(
        data.presentations[j].name,
        presenters[j],
        "Incorrect presenter order."
      );

      assert.equal(
        data.presentations[j].score,
        [8, 9, 7, 10][j],
        "Incorrect stored score."
      );
    }
  }

  // ===================================================
  // DUPLICATE PROTECTION TEST
  // ===================================================

  const firstDocument = collection.doc(
    `Seminar_1_${runId}_user0`
  );

  await assert.rejects(
    firstDocument.create({
      uid: "duplicate"
    }),
    error =>
      error.code === 6 ||
      error.code === "already-exists",
    "Duplicate document creation must fail."
  );

  const firstAfter = await firstDocument.get();

  assert.equal(
    firstAfter.data().uid,
    `${runId}_user0`,
    "Original vote was overwritten."
  );

  // ===================================================
  // RESULTS
  // ===================================================

  const summary = {
    concurrent: count,
    successful: successful.length,
    failed: failures.length,
    stored: stored,
    duplicatesBlocked: true,
    totalMs: Math.round(performance.now() - started),
    medianWriteMs: Math.round(
      percentile(timings, 0.5)
    ),
    p95WriteMs: Math.round(
      percentile(timings, 0.95)
    )
  };

  console.log("");
  console.log("TEST RESULTS:");
  console.log(JSON.stringify(summary, null, 2));

  console.log(
    `PASS: ${count}/${count} votes stored correctly.`
  );
}

// =====================================================
// MAIN
// =====================================================

async function main() {
  console.log("PhD Seminar Voting 2026/2027");
  console.log("Firestore Emulator Load Test");
  console.log(`Project: ${PROJECT_ID}`);

  try {
    for (const size of sizes) {
      await runBatch(size);
    }

    console.log("");
    console.log("======================================");
    console.log("ALL LOAD TESTS PASSED");
    console.log("======================================");
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  console.error("LOAD TEST FAILED:", error);
  process.exitCode = 1;
});
