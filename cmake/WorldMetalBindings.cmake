# SPIR-V binding slots are remapped for Metal's separate buffer namespace.
# SDL MSL contract: [[buffer]] holds uniform buffers first, then storage buffers.
# The fallback world shader has one uniform buffer (Surface u), so its storage
# buffer starts at 1. The batch variant has no uniform buffer, so storage
# buffers start at 0: batch=0, shadow=1.
file(READ "${INPUT}" source)
string(FIND "${source}" "batch [[buffer(1)]]" batched)
if(NOT batched EQUAL -1)
    string(REPLACE "batch [[buffer(1)]]" "batch [[buffer(0)]]" source "${source}")
    string(REPLACE "shadow [[buffer(3)]]" "shadow [[buffer(1)]]" source "${source}")
    string(FIND "${source}" "batch [[buffer(0)]]" still_batch)
    string(FIND "${source}" "shadow [[buffer(1)]]" still_shadow)
    if(still_batch EQUAL -1 OR still_shadow EQUAL -1)
        message(FATAL_ERROR "World batch Metal storage binding contract changed")
    endif()
else()
    string(FIND "${source}" "shadow [[buffer(3)]]" legacy)
    if(legacy EQUAL -1)
        # The generated MSL can already be remapped in place by a previous
        # configure/build; accept the final contract idempotently.
        string(FIND "${source}" "shadow [[buffer(1)]]" remapped)
        if(remapped EQUAL -1)
            message(FATAL_ERROR "World Metal storage binding contract changed")
        endif()
    else()
        string(REPLACE "shadow [[buffer(3)]]" "shadow [[buffer(1)]]" source "${source}")
    endif()
endif()
file(WRITE "${INPUT}" "${source}")
