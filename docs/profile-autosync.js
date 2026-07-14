(() => {
  async function migrateExistingProfilePhoto() {
    try {
      if (!currentUser || profileAvatarPath || !profilePhoto?.startsWith('data:')) return;
      await saveProfileToSupabase({ uploadPhoto: true });
      showToast('Profile picture synced');
    } catch (error) {
      console.error('Existing profile picture sync failed', error);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(migrateExistingProfilePhoto, 1800);
  });

  window.addEventListener('focus', migrateExistingProfilePhoto);
})();
