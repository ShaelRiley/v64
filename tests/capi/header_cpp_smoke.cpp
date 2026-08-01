#include "video64/v64.h"

static_assert(V64_ABI_VERSION == 1u);
static_assert(V64_BYTE_ERROR == 256u);

int main() { return v64_abi_version() == V64_ABI_VERSION ? 0 : 1; }
