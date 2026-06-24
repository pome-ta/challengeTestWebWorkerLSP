// core/error-codes.js

/**
 * JSON-RPC 2.0 and LSP standard error codes.
 * @see https://www.jsonrpc.org/specification#error_object
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#errorCodes
 */
export const JsonRpcErrorCode = {
  // JSON-RPC 2.0 Pre-defined errors
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,

  // A generic server error for implementation-defined server-errors (-32000 to -32099)
  ServerError: -32000,
  // LSP specific error codes
  // @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#errorCodes
  ServerNotInitialized: -32002,
  UnknownErrorCode: -32001,
};
