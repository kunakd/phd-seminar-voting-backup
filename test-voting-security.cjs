'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, serverTimestamp } = require('firebase/firestore');

const projectId = 'demo-voting-security';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host !== '127.0.0.1:8080' || process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error('Safety check failed: use only local demo emulator.');
}
const presenters = ['Botond Bolgár', 'Tereza Kárníková', 'Deepak Kumar Bhuyan', 'Aparna Vijayalekshmi Muraleedharan'];
const ballot = (uid, email, overrides={}) => ({
  participant: email, uid, seminar: 'Seminar 1',
  presentations: presenters.map(name => ({name, score: 8, comment: 'Test comment'})),
  timestamp: serverTimestamp(), ...overrides
});

(async () => {
  const rules = fs.readFileSync('firestore.security-test.rules', 'utf8');
  assert(rules.includes('2099-01-01T00:00:00Z'), 'Only test rules with widened window are allowed');
  const env = await initializeTestEnvironment({
    projectId, firestore: { host: '127.0.0.1', port: 8080, rules }
  });
  let passed = 0;
  async function check(label, promise, allowed) {
    if (allowed) await assertSucceeds(promise);
    else await assertFails(promise);
    console.log(`PASS ${++passed}: ${label}`);
  }
  try {
    const a = env.authenticatedContext('studentA', {email:'studentA@natur.cuni.cz',email_verified:true}).firestore();
    const b = env.authenticatedContext('studentB', {email:'studentB@uochb.cas.cz',email_verified:true}).firestore();
    const unverified = env.authenticatedContext('unverified', {email:'unverified@natur.cuni.cz',email_verified:false}).firestore();
    const external = env.authenticatedContext('external', {email:'external@example.com',email_verified:true}).firestore();
    const anon = env.unauthenticatedContext().firestore();
    const ref = doc(a, 'votes_2026_2027', 'Seminar_1_studentA');
    await check('verified institutional student can create', setDoc(ref, ballot('studentA','studentA@natur.cuni.cz')), true);
    await check('cannot overwrite submitted vote', setDoc(ref, ballot('studentA','studentA@natur.cuni.cz', {presentations:presenters.map(name=>({name,score:1,comment:''}))})), false);
    await check('cannot update vote', updateDoc(ref, {seminar:'Seminar 2'}), false);
    await check('cannot delete vote', deleteDoc(ref), false);
    await check('cannot read own vote', getDoc(ref), false);
    await check('cannot read another vote', getDoc(doc(b,'votes_2026_2027','Seminar_1_studentA')), false);
    await check('cannot list votes', getDocs(collection(a,'votes_2026_2027')), false);
    await check('unverified account rejected', setDoc(doc(unverified,'votes_2026_2027','Seminar_1_unverified'),ballot('unverified','unverified@natur.cuni.cz')), false);
    await check('external account rejected', setDoc(doc(external,'votes_2026_2027','Seminar_1_external'),ballot('external','external@example.com')), false);
    await check('anonymous account rejected', setDoc(doc(anon,'votes_2026_2027','Seminar_1_anon'),ballot('anon','anon@natur.cuni.cz')), false);
    await check('wrong document UID rejected', setDoc(doc(b,'votes_2026_2027','Seminar_1_wrong'),ballot('studentB','studentB@uochb.cas.cz')), false);
    await check('wrong participant email rejected', setDoc(doc(b,'votes_2026_2027','Seminar_1_studentB'),ballot('studentB','other@uochb.cas.cz')), false);
    await check('score outside 1-10 rejected', setDoc(doc(b,'votes_2026_2027','Seminar_1_studentB'),ballot('studentB','studentB@uochb.cas.cz',{presentations:presenters.map(name=>({name,score:11,comment:''}))})), false);
    await check('wrong presenter order rejected', setDoc(doc(b,'votes_2026_2027','Seminar_1_studentB'),ballot('studentB','studentB@uochb.cas.cz',{presentations:presenters.slice().reverse().map(name=>({name,score:8,comment:''}))})), false);
    await check('comment over 2000 characters rejected', setDoc(doc(b,'votes_2026_2027','Seminar_1_studentB'),ballot('studentB','studentB@uochb.cas.cz',{presentations:presenters.map(name=>({name,score:8,comment:'x'.repeat(2001)}))})), false);
    await check('missing timestamp rejected', setDoc(doc(b,'votes_2026_2027','Seminar_1_studentB'),ballot('studentB','studentB@uochb.cas.cz',{timestamp:null})), false);
    await check('wrong seminar or outside production window rejected', setDoc(doc(b,'votes_2026_2027','Seminar_2_studentB'),ballot('studentB','studentB@uochb.cas.cz',{seminar:'Seminar 2'})), false);
    await check('second verified student can create', setDoc(doc(b,'votes_2026_2027','Seminar_1_studentB'),ballot('studentB','studentB@uochb.cas.cz')), true);
    console.log(`ALL ${passed} SECURITY TESTS PASSED`);
  } finally { await env.cleanup(); }
})().catch(err => { console.error(err); process.exitCode=1; });
