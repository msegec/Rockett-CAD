#include <cmath>

namespace
{

constexpr int FILLET_INPUTS = 19;
constexpr int FILLET_OUTPUTS = 18;
constexpr int CHAMFER_INPUTS = 21;
constexpr int CHAMFER_OUTPUTS = 12;
constexpr int SIZE = FILLET_INPUTS + FILLET_OUTPUTS > CHAMFER_INPUTS + CHAMFER_OUTPUTS
    ? FILLET_INPUTS + FILLET_OUTPUTS
    : CHAMFER_INPUTS + CHAMFER_OUTPUTS;
constexpr double ANGULAR = 1e-9;

double io[SIZE];

struct Vec {
    double x, y, z;
};

Vec operator+(Vec a, Vec b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
Vec operator-(Vec a, Vec b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
Vec operator*(double s, Vec a) { return {s * a.x, s * a.y, s * a.z}; }
double dot(Vec a, Vec b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

Vec read(int at) { return {io[at], io[at + 1], io[at + 2]}; }

void write(int at, Vec v)
{
    io[at] = v.x;
    io[at + 1] = v.y;
    io[at + 2] = v.z;
}

void require_finite(int count)
{
    for (int i = 0; i < count; i++) {
        if (!std::isfinite(io[i])) __builtin_trap();
    }
}

struct Side {
    Vec normal, into;
    double radius;
};

Vec chamfer_contact(Vec p, Side side, double distance)
{
    if (side.radius == 0) return p + distance * side.into;
    const double r = std::fabs(side.radius);
    const Vec c = p - side.radius * side.normal;
    const Vec u = (1 / r) * (p - c);
    const double theta = 2 * std::asin(distance / (2 * r));
    return c + r * (std::cos(theta) * u + std::sin(theta) * side.into);
}

}

extern "C" double* buffer() { return io; }

extern "C" int fillet_planes()
{
    require_finite(FILLET_INPUTS);
    const Vec p0 = read(0), p1 = read(3), n1 = read(6), w1 = read(9), n2 = read(12), w2 = read(15);
    const double radius = io[18];
    const double length = std::sqrt(dot(p1 - p0, p1 - p0));
    if (radius <= 0 || length <= 0) return 1;
    const Vec d = (1 / length) * (p1 - p0);
    if (std::fabs(dot(n1, d)) > ANGULAR || std::fabs(dot(n2, d)) > ANGULAR) return 1;
    const double cosine = dot(n1, n2);
    if (1 + cosine < ANGULAR || 1 - cosine < ANGULAR) return 1;
    const Vec centre = (-radius / (1 + cosine)) * (n1 + n2);
    const Vec contact1 = centre + radius * n1, contact2 = centre + radius * n2;
    if (dot(contact1, w1) <= 0 || dot(contact2, w2) <= 0) return 1;
    for (int end = 0; end < 2; end++) {
        const Vec at = end == 0 ? p0 : p1;
        write(FILLET_INPUTS + 9 * end, at + centre);
        write(FILLET_INPUTS + 9 * end + 3, at + contact1);
        write(FILLET_INPUTS + 9 * end + 6, at + contact2);
    }
    return 0;
}

extern "C" int chamfer_section()
{
    require_finite(CHAMFER_INPUTS);
    const Vec p0 = read(0), p1 = read(3);
    const Side sides[2] = {{read(6), read(9), io[12]}, {read(13), read(16), io[19]}};
    const double distance = io[20];
    const double length = std::sqrt(dot(p1 - p0, p1 - p0));
    if (distance <= 0 || length <= 0) return 1;
    const Vec d = (1 / length) * (p1 - p0);
    for (const Side& side : sides) {
        if (std::fabs(dot(side.normal, d)) > ANGULAR || std::fabs(dot(side.into, d)) > ANGULAR) return 1;
        if (side.radius != 0 && distance > 2 * std::fabs(side.radius)) return 1;
    }
    if (1 - std::fabs(dot(sides[0].normal, sides[1].normal)) < ANGULAR) return 1;
    for (int end = 0; end < 2; end++) {
        const Vec at = end == 0 ? p0 : p1;
        write(CHAMFER_INPUTS + 6 * end, chamfer_contact(at, sides[0], distance));
        write(CHAMFER_INPUTS + 6 * end + 3, chamfer_contact(at, sides[1], distance));
    }
    return 0;
}
