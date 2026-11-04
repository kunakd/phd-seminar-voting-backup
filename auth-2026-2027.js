(function () {
  "use strict";
  const auth = firebase.auth();
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const status = document.getElementById("authStatus");
  const signInBtn = document.getElementById("signInBtn");
  const registerBtn = document.getElementById("registerBtn");
  const resetPasswordBtn = document.getElementById("resetPasswordBtn");
  const verifyBtn = document.getElementById("verifyEmailBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const checkBtn = document.getElementById("checkVerificationBtn");
  let working = false;

  function validEmail(email) {
    return /^[^@\s]+@(natur\.cuni\.cz|uochb\.cas\.cz)$/i.test(String(email || "").trim());
  }
  function showStatus(text, error = false) {
    status.textContent = text;
    status.className = error ? "error" : "";
  }
  function updateUI(user) {
    signOutBtn.style.display = user ? "inline-block" : "none";
    signInBtn.style.display = user ? "none" : "inline-block";
    registerBtn.style.display = user ? "none" : "inline-block";
    resetPasswordBtn.style.display = user ? "none" : "inline-block";
    verifyBtn.style.display = user && !user.emailVerified ? "inline-block" : "none";
    checkBtn.style.display = user && !user.emailVerified ? "inline-block" : "none";
    window.votingUserAuthorized = Boolean(user && user.emailVerified && validEmail(user.email));
    if (typeof window.updateVotingAccess === "function") window.updateVotingAccess();
    if (!user) showStatus("Please sign in to vote.");
    else if (!validEmail(user.email)) showStatus("This account does not use an approved institutional email.", true);
    else if (!user.emailVerified) showStatus("Please verify your email address. Then click 'Check verification'.");
    else showStatus("Signed in as " + user.email);
  }
  function setWorking(value) {
    working = value;
    [signInBtn, registerBtn, resetPasswordBtn, verifyBtn, signOutBtn, checkBtn]
      .forEach(button => { button.disabled = value; });
  }
  async function action(fn) {
    if (working) return;
    setWorking(true);
    try { await fn(); }
    catch (error) {
      console.error("Authentication operation failed", error.code || error.message);
      showStatus(error.message || "Authentication operation failed.", true);
    } finally { setWorking(false); }
  }

  signInBtn.addEventListener("click", () => action(async () => {
    const email = emailInput.value.trim().toLowerCase();
    if (!validEmail(email)) throw new Error("Please use an approved institutional email.");
    const result = await auth.signInWithEmailAndPassword(email, passwordInput.value);
    passwordInput.value = "";
    await result.user.reload();
    updateUI(auth.currentUser);
  }));

  registerBtn.addEventListener("click", () => action(async () => {
    const email = emailInput.value.trim().toLowerCase();
    if (!validEmail(email)) throw new Error("Please use an approved institutional email.");
    const result = await auth.createUserWithEmailAndPassword(email, passwordInput.value);
    passwordInput.value = "";
    await result.user.sendEmailVerification();
    updateUI(auth.currentUser);
    showStatus("Verification email sent. Please check your inbox.");
  }));

  resetPasswordBtn.addEventListener("click", () => action(async () => {
    const email = emailInput.value.trim().toLowerCase();
    if (!validEmail(email)) throw new Error("Please enter your institutional email address first.");
    try { await auth.sendPasswordResetEmail(email); }
    catch (error) {
      if (error.code !== "auth/user-not-found" && error.code !== "auth/invalid-email") throw error;
    }
    showStatus("If an account exists for this email, a password reset message will be sent. Check your inbox and spam folder.");
  }));

  verifyBtn.addEventListener("click", () => action(async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("Please sign in first.");
    await user.reload();
    if (auth.currentUser.emailVerified) {
      updateUI(auth.currentUser);
    } else {
      await user.sendEmailVerification();
      showStatus("Verification email sent. Check your inbox and spam folder.");
    }
  }));

  checkBtn.addEventListener("click", () => action(async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("Please sign in first.");
    await user.reload();
    updateUI(auth.currentUser);
  }));

  signOutBtn.addEventListener("click", () => action(async () => {
    const submit = document.querySelector('#voteForm button[type="submit"]');
    const seminar = document.getElementById("seminar");
    if (seminar.disabled && submit.disabled) {
      throw new Error("A submission may be pending. Wait for server confirmation before signing out.");
    }
    await auth.signOut();
  }));

  // Single authentication listener; voting module receives updates through updateUI.
  auth.onAuthStateChanged(updateUI);
})();
