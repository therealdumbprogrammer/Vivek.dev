# Byte 012 review notes

- Reviewed draft retrieval is truncated at 20,000 characters, during logical-versus-compiled frames. Original byte is complete. Remaining sections follow the explicit request and original byte.
- Preserve reviewed concepts while matching connected course prose and 480px diagram conventions. Twelve original SVGs.
- Correct historical long/double phrasing: two consecutive local slots remain required by JVMS 25. max_stack measures depth units; long/double contribute two.
- Local slots are not source variables; no read of the result before its store. A frame belongs to an invocation, with its own operand stack. Method calls transfer arguments to locals and return values to caller operands.
- Logical frames do not imply one physical frame per Java call after inlining. GC uses live reference metadata, not source scope alone.
- Draft remains local-only; no publication requested. Existing Lessons 10/11 edits preserved.
