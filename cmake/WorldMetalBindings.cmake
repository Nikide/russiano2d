# SPIR-V fragment binding 3 follows three texture samplers. Metal buffer slots
# are a separate namespace: SDL requires uniform buffer 0, storage buffer 1.
file(READ "${INPUT}" source)
string(FIND "${source}" "shadow [[buffer(3)]]" found)
if(found EQUAL -1)
    message(FATAL_ERROR "World Metal storage binding contract changed")
endif()
string(REPLACE "shadow [[buffer(3)]]" "shadow [[buffer(1)]]" source "${source}")
file(WRITE "${INPUT}" "${source}")
