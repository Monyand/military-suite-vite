// Four independent entry points produce separate production chunks. Loading
// them together retains the existing cross-module sync and mounted form state.
export async function loadModules() {
  const [events, medical, personnel, documents] = await Promise.all([
    import('../modules/events/index.js'),
    import('../modules/medical/index.js'),
    import('../modules/personnel/index.js'),
    import('../modules/documents/index.js'),
  ]);
  personnel.mountPersonnelShell();
  personnel.createPersonnelModule();
  return {
    EventsApp: events.EventsApp,
    MedicalApp: medical.MedicalApp,
    createPersonnelModule: personnel.createPersonnelModule,
    DocumentJournalApp: documents.DocumentJournalApp,
  };
}
