const form = document.querySelector('#reply-form');
const passwordInput = document.querySelector('#password');
const messageInput = document.querySelector('#message');
const toneInput = document.querySelector('#tone');
const count = document.querySelector('#character-count');
const result = document.querySelector('#result');
const status = document.querySelector('#status');
const generateButton = document.querySelector('#generate-button');
const copyButton = document.querySelector('#copy-button');

passwordInput.value = sessionStorage.getItem('swiftreply-password') || '';

messageInput.addEventListener('input', () => {
  count.textContent = `${messageInput.value.length} / 4000`;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  const message = messageInput.value.trim();
  if (!password || !message) return;

  sessionStorage.setItem('swiftreply-password', password);
  generateButton.disabled = true;
  generateButton.classList.add('loading');
  status.classList.remove('error');
  status.textContent = 'Writing your reply…';
  result.classList.add('empty');
  result.textContent = 'Thinking through the best wording.';
  copyButton.disabled = true;

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Password': password,
      },
      body: JSON.stringify({ message, tone: toneInput.value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to generate a reply.');

    result.textContent = payload.reply;
    result.classList.remove('empty');
    status.textContent = `Generated with ${payload.model}. ${payload.remainingRequests} requests remaining this hour.`;
    copyButton.disabled = false;
  } catch (error) {
    result.textContent = 'No reply was generated.';
    status.textContent = error.message;
    status.classList.add('error');
  } finally {
    generateButton.disabled = false;
    generateButton.classList.remove('loading');
  }
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(result.textContent);
  copyButton.textContent = 'Copied';
  setTimeout(() => { copyButton.textContent = 'Copy'; }, 1400);
});
