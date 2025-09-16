precision highp float;

varying highp vec2 vTextureCoord;
varying vec4 vVertexColor;

uniform sampler2D pt_layer0;
uniform sampler2D pt_layer1;
uniform sampler2D pt_layer2;
uniform sampler2D pt_layer3;

uniform float layerScale0;
uniform float layerScale1;
uniform float layerScale2;
uniform float layerScale3;

uniform sampler2D pt_blend1;
uniform sampler2D pt_blend2;
uniform sampler2D pt_blend3;

void main() {
	vec2 tc0 = vTextureCoord * (8.0 / layerScale0);
	vec2 tc1 = vTextureCoord * (8.0 / layerScale1);
	vec2 tc2 = vTextureCoord * (8.0 / layerScale2);
	vec2 tc3 = vTextureCoord * (8.0 / layerScale3);

	float a0 = texture2D(pt_blend1, mod(vTextureCoord, 1.0)).r;
	float a1 = texture2D(pt_blend2, mod(vTextureCoord, 1.0)).r;
	float a2 = texture2D(pt_blend3, mod(vTextureCoord, 1.0)).r;

	vec3 t0 = texture2D(pt_layer0, tc0).rgb;
	vec3 t1 = texture2D(pt_layer1, tc1).rgb;
	vec3 t2 = texture2D(pt_layer2, tc2).rgb;
	vec3 t3 = texture2D(pt_layer3, tc3).rgb;

	float base = 1.0 - (a0 + a1 + a2);
	vec3 color = t0 * base + t1 * a0 + t2 * a1 + t3 * a2;
	gl_FragColor = vec4(color * vVertexColor.rgb * 2.0, 1.0);
}