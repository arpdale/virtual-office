import { useCallback, useEffect, useRef, useState } from 'react';

import { toMajorMinor } from './changelogData.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { ChangelogModal } from './components/ChangelogModal.js';
import { DebugView } from './components/DebugView.js';
import { EditActionBar } from './components/EditActionBar.js';
import { MigrationNotice } from './components/MigrationNotice.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Tooltip } from './components/Tooltip.js';
import { Modal } from './components/ui/Modal.js';
import { VersionIndicator } from './components/VersionIndicator.js';
import { ZoomControls } from './components/ZoomControls.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { BoardMeetingOverlay } from './components/BoardMeetingOverlay.js';
import { MeetingGatheringIndicator } from './components/MeetingGatheringIndicator.js';
import { MeetingSelector } from './components/MeetingSelector.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { VPOverlay } from './components/VPOverlay.js';
import { callBoardMeeting } from './office/boardMeeting.js';
import { getCharacterIdForVp, getVpIdForCharacter, loadBoardroomVPs, spawnBoardroomVP, setVPActive } from './office/boardroomRoster.js';
import { CharacterState } from './office/types.js';
import { getVP } from './services/boardroom.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { OfficeState } from './office/engine/officeState.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { EditTool } from './office/types.js';
import { isBrowserRuntime } from './runtime.js';
import { transport } from './transport/index.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

function App() {
  // Browser runtime (dev or static dist): dispatch mock messages after the
  // useExtensionMessages listener has been registered.
  useEffect(() => {
    // browserMock is for Vite dev mode only (UI prototyping without a server).
    // In standalone server mode, the server sends all state over WebSocket.
    // In VS Code mode, the extension sends all state via postMessage.
    if (isBrowserRuntime && import.meta.env.DEV) {
      void import('./browserMock.js').then(({ dispatchMockMessages }) => dispatchMockMessages());
    }
  }, []);

  const editor = useEditorActions(getOfficeState, editorState);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels,
    hooksEnabled,
    setHooksEnabled,
    hooksInfoShown,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);

  // Show migration notice once layout reset is detected
  const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false);
  const showMigrationNotice = layoutWasReset && !migrationNoticeDismissed;

  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHooksInfoOpen, setIsHooksInfoOpen] = useState(false);
  const [hooksTooltipDismissed, setHooksTooltipDismissed] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [alwaysShowOverlay, setAlwaysShowOverlay] = useState(false);

  const currentMajorMinor = toMajorMinor(extensionVersion);

  const handleWhatsNewDismiss = useCallback(() => {
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  const handleOpenChangelog = useCallback(() => {
    setIsChangelogOpen(true);
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  // Sync alwaysShowOverlay from persisted settings
  useEffect(() => {
    setAlwaysShowOverlay(alwaysShowLabels);
  }, [alwaysShowLabels]);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);
  const handleToggleAlwaysShowOverlay = useCallback(() => {
    setAlwaysShowOverlay((prev) => {
      const newVal = !prev;
      transport.send({ type: 'setAlwaysShowLabels', enabled: newVal });
      return newVal;
    });
  }, []);

  const handleSelectAgent = useCallback((id: number) => {
    transport.send({ type: 'focusAgent', id });
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  const handleCloseAgent = useCallback((id: number) => {
    // Backend-VP characters: the X button collapses the info tooltip.
    // VPs aren't "closed" like terminals — they live in the DB. To remove
    // a VP permanently, use the Personality tab → Archive (future).
    if (getVpIdForCharacter(id)) {
      const os = getOfficeState();
      if (os.selectedAgentId === id) os.selectedAgentId = null;
      return;
    }
    // Legacy terminal-bound flow
    transport.send({ type: 'closeAgent', id });
  }, []);

  const [overlayVpId, setOverlayVpId] = useState<string | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isMeetingSelectorOpen, setIsMeetingSelectorOpen] = useState(false);
  // Gathering phase: VPs walk to seats first (cutscene). Once at seats (or
  // user clicks Skip), transitions into a real meetingState.
  const [gatheringState, setGatheringState] = useState<{
    participantIds: string[];
    subject: string;
    seatedCount: number;
  } | null>(null);
  const [meetingState, setMeetingState] = useState<{
    participantIds: string[];
    subject: string;
  } | null>(null);
  const skipGatherRef = useRef(false);

  // Office state singleton (imperative — lives outside React). Pulled up here
  // so all the meeting callbacks below can close over it.
  const officeState = getOfficeState();

  const handleStartMeeting = useCallback(
    (participantIds: string[], subject: string) => {
      setIsMeetingSelectorOpen(false);
      skipGatherRef.current = false;
      setGatheringState({ participantIds, subject, seatedCount: 0 });
      // Kick the walks immediately so they start moving while the
      // indicator appears.
      callBoardMeeting(officeState, participantIds);
    },
    [officeState],
  );

  const handleSkipGather = useCallback(() => {
    skipGatherRef.current = true;
  }, []);

  // Poll until all selected VPs are at their seats (CharacterState.TYPE), or
  // until the user skips, or until 12s safety timeout. Then promote
  // gatheringState → meetingState.
  useEffect(() => {
    if (!gatheringState) return;
    const start = Date.now();
    const TIMEOUT_MS = 12_000;
    const ids = gatheringState.participantIds;
    const total = ids.length;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsed = Date.now() - start;
      let seated = 0;
      for (const vpId of ids) {
        const cid = getCharacterIdForVp(vpId);
        if (cid === undefined) continue;
        const ch = officeState.characters.get(cid);
        if (ch?.state === CharacterState.TYPE) seated++;
      }
      setGatheringState((g) => (g ? { ...g, seatedCount: seated } : g));

      const allSeated = seated >= total;
      const timedOut = elapsed > TIMEOUT_MS;
      if (allSeated || timedOut || skipGatherRef.current) {
        // Promote
        setGatheringState(null);
        setMeetingState({
          participantIds: ids,
          subject: gatheringState.subject,
        });
        return;
      }
      setTimeout(tick, 200);
    };
    setTimeout(tick, 200);

    return () => {
      cancelled = true;
    };
    // gatheringState dependency intentionally NOT included beyond initial
    // entry — we only run the poll once per gather session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatheringState?.participantIds.join(','), officeState]);

  const handleEndMeeting = useCallback(() => {
    setMeetingState(null);
    // Stand everyone back up
    for (const vpId of meetingState?.participantIds ?? []) {
      setVPActive(officeState, vpId, false);
    }
  }, [meetingState, officeState]);

  const handleVPCommitted = useCallback(
    async (committed: { suggested_id: string }) => {
      // After wizard commits, refetch the new VP and spawn its character.
      try {
        const vp = await getVP(committed.suggested_id);
        spawnBoardroomVP(getOfficeState(), {
          id: vp.id,
          name: vp.name,
          role: vp.role,
          description: vp.description,
          palette: vp.palette,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[boardroom] failed to spawn new VP:', err);
      }
    },
    [],
  );

  const handleClick = useCallback((agentId: number) => {
    // Backend-VP characters: open the boardroom overlay
    const vpId = getVpIdForCharacter(agentId);
    if (vpId) {
      setOverlayVpId(vpId);
      return;
    }
    // Legacy terminal-bound flow (kept while we still spawn sub-agents):
    const os = getOfficeState();
    const meta = os.subagentMeta.get(agentId);
    const focusId = meta ? meta.parentAgentId : agentId;
    transport.send({ type: 'focusAgent', id: focusId });
  }, []);

  // Boardroom roster: once the office layout is loaded, fetch the VP list from
  // the boardroom backend and spawn one character per VP. Each VP's `palette`
  // (0-5) determines the sprite skin. Failures (backend down) log + bail —
  // the office still renders, just empty.
  useEffect(() => {
    if (!layoutReady) return;
    let cancelled = false;
    (async () => {
      try {
        const vps = await loadBoardroomVPs(officeState);
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.log(`[boardroom] spawned ${vps.length} VPs:`, vps.map((v) => v.name));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[boardroom] failed to load VPs:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [layoutReady, officeState]);

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  if (!layoutReady) {
    return <div className="w-full h-full flex items-center justify-center ">Loading...</div>;
  }

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
      />

      {!isDebugMode ? (
        <>
          <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />

          {/* Vignette overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'var(--vignette)' }}
          />

          {editor.isEditMode && editor.isDirty && (
            <EditActionBar editor={editor} editorState={editorState} />
          )}

          {showRotateHint && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-11 bg-accent-bright text-white text-sm py-3 px-8 rounded-none border-2 border-accent shadow-pixel pointer-events-none whitespace-nowrap"
              style={{ top: editor.isDirty ? 64 : 8 }}
            >
              Rotate (R)
            </div>
          )}

          {editor.isEditMode &&
            (() => {
              const selUid = editorState.selectedFurnitureUid;
              const selColor = selUid
                ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
                : null;
              return (
                <EditorToolbar
                  activeTool={editorState.activeTool}
                  selectedTileType={editorState.selectedTileType}
                  selectedFurnitureType={editorState.selectedFurnitureType}
                  selectedFurnitureUid={selUid}
                  selectedFurnitureColor={selColor}
                  floorColor={editorState.floorColor}
                  wallColor={editorState.wallColor}
                  selectedWallSet={editorState.selectedWallSet}
                  onToolChange={editor.handleToolChange}
                  onTileTypeChange={editor.handleTileTypeChange}
                  onFloorColorChange={editor.handleFloorColorChange}
                  onWallColorChange={editor.handleWallColorChange}
                  onWallSetChange={editor.handleWallSetChange}
                  onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                  onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                  loadedAssets={loadedAssets}
                />
              );
            })()}

          <ToolOverlay
            officeState={officeState}
            agents={agents}
            agentTools={agentTools}
            subagentCharacters={subagentCharacters}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
            onCloseAgent={handleCloseAgent}
            alwaysShowOverlay={alwaysShowOverlay}
          />
        </>
      ) : (
        <DebugView
          agents={agents}
          selectedAgent={selectedAgent}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          subagentTools={subagentTools}
          onSelectAgent={handleSelectAgent}
        />
      )}

      {/* Hooks first-run tooltip */}
      {!hooksInfoShown && !hooksTooltipDismissed && (
        <Tooltip
          title="Instant Detection Active"
          position="top-right"
          onDismiss={() => {
            setHooksTooltipDismissed(true);
            transport.send({ type: 'setHooksInfoShown' });
          }}
        >
          <span className="text-sm text-text leading-none">
            Your agents now respond in real-time.{' '}
            <span
              className="text-accent cursor-pointer underline"
              onClick={() => {
                setIsHooksInfoOpen(true);
                setHooksTooltipDismissed(true);
                transport.send({ type: 'setHooksInfoShown' });
              }}
            >
              View more
            </span>
          </span>
        </Tooltip>
      )}

      {/* Hooks info modal */}
      <Modal
        isOpen={isHooksInfoOpen}
        onClose={() => setIsHooksInfoOpen(false)}
        title="Instant Detection is ON"
        zIndex={52}
      >
        <div className="text-base text-text px-10" style={{ lineHeight: 1.4 }}>
          <p className="mb-8">Your Pixel Agents office now reacts in real-time:</p>
          <ul className="mb-8 pl-18 list-disc m-0">
            <li className="text-sm mb-2">Permission prompts appear instantly</li>
            <li className="text-sm mb-2">Turn completions detected the moment they happen</li>
            <li className="text-sm mb-2">Sound notifications play immediately</li>
          </ul>
          <p className="mb-12 text-text-muted">
            This works through Claude Code Hooks, small event listeners that notify Pixel Agents
            whenever something happens in your Claude sessions.
          </p>
          <div className="text-center">
            <button
              onClick={() => setIsHooksInfoOpen(false)}
              className="py-4 px-20 text-lg bg-accent text-white border-2 border-accent rounded-none cursor-pointer shadow-pixel"
            >
              Got it
            </button>
          </div>
          <p className="mt-8 text-xs text-text-muted text-center">
            To disable, go to Settings {'>'} Instant Detection
          </p>
        </div>
      </Modal>

      <BottomToolbar
        isEditMode={editor.isEditMode}
        onOpenClaude={editor.handleOpenClaude}
        onToggleEditMode={editor.handleToggleEditMode}
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={() => setIsSettingsOpen((v) => !v)}
        workspaceFolders={workspaceFolders}
        onAddVP={() => setIsOnboardingOpen(true)}
        onBoardMeeting={() => setIsMeetingSelectorOpen(true)}
        meetingInProgress={!!meetingState}
      />

      <VersionIndicator
        currentVersion={extensionVersion}
        lastSeenVersion={lastSeenVersion}
        onDismiss={handleWhatsNewDismiss}
        onOpenChangelog={handleOpenChangelog}
      />

      <ChangelogModal
        isOpen={isChangelogOpen}
        onClose={() => setIsChangelogOpen(false)}
        currentVersion={extensionVersion}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        isDebugMode={isDebugMode}
        onToggleDebugMode={handleToggleDebugMode}
        alwaysShowOverlay={alwaysShowOverlay}
        onToggleAlwaysShowOverlay={handleToggleAlwaysShowOverlay}
        externalAssetDirectories={externalAssetDirectories}
        watchAllSessions={watchAllSessions}
        onToggleWatchAllSessions={() => {
          const newVal = !watchAllSessions;
          setWatchAllSessions(newVal);
          transport.send({ type: 'setWatchAllSessions', enabled: newVal });
        }}
        hooksEnabled={hooksEnabled}
        onToggleHooksEnabled={() => {
          const newVal = !hooksEnabled;
          setHooksEnabled(newVal);
          transport.send({ type: 'setHooksEnabled', enabled: newVal });
        }}
      />

      {showMigrationNotice && (
        <MigrationNotice onDismiss={() => setMigrationNoticeDismissed(true)} />
      )}

      {overlayVpId && (
        <VPOverlay
          vpId={overlayVpId}
          officeState={officeState}
          visible={overlayVisible}
          onHide={() => setOverlayVisible(false)}
          onShow={() => setOverlayVisible(true)}
          onClose={() => {
            setOverlayVpId(null);
            setOverlayVisible(true); // reset for next open
          }}
        />
      )}

      <OnboardingWizard
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onCommitted={(preview) => {
          void handleVPCommitted(preview);
        }}
      />

      <MeetingSelector
        isOpen={isMeetingSelectorOpen}
        onClose={() => setIsMeetingSelectorOpen(false)}
        onStart={handleStartMeeting}
      />

      {gatheringState && (
        <MeetingGatheringIndicator
          arrived={gatheringState.seatedCount}
          total={gatheringState.participantIds.length}
          onSkip={handleSkipGather}
        />
      )}

      {meetingState && (
        <BoardMeetingOverlay
          isOpen
          participantIds={meetingState.participantIds}
          subject={meetingState.subject}
          officeState={officeState}
          onClose={handleEndMeeting}
        />
      )}
    </div>
  );
}

export default App;
