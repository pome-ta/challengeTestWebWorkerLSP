import { expect } from "./test-utils.js";
import { startWorker, sendRequest, addResult } from "./test-utils.js";

(async () => {
  const worker = await startWorker();

  try {
    await sendRequest(worker, "vfs/resetForTest");
    await sendRequest(worker, "vfs/ensureReady");

    const filePath = "/src/update-test.ts";
    const initialContent = "export const a = 1;";
    const updatedContent = "export const a = 2;";

    // 1) 初回作成: updateFile(name, content)
    const r1 = await sendRequest(worker, "vfs/updateFile", {
      path: filePath,
      content: initialContent
    });
    expect(r1.ok).to.equal(true);

    // 2) getFileSnapshot (内部 _getFile)
    const snap1 = await sendRequest(worker, "vfs/_getFile", { path: filePath });
    expect(snap1.path).to.equal(filePath);
    expect(snap1.text).to.equal(initialContent);

    // 3) 上書き更新
    const r2 = await sendRequest(worker, "vfs/updateFile", {
      path: filePath,
      content: updatedContent
    });
    expect(r2.ok).to.equal(true);

    // 4) 再度 getFileSnapshot して、上書きされた内容であることを確認
    const snap2 = await sendRequest(worker, "vfs/_getFile", { path: filePath });
    expect(snap2.text).to.equal(updatedContent);

    addResult({
      name: "VfsCore updateFile: basic overwrite test",
      status: "Passed"
    });
  } catch (err) {
    addResult({
      name: "VfsCore updateFile: basic overwrite test",
      status: "Failed",
      error: String(err)
    });
  } finally {
    worker.terminate();
  }
})();